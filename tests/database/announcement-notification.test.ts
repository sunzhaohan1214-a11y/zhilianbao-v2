import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { AnnouncementService } from "@/modules/announcement/announcement-service";
import { registerAnnouncementAttachmentAuthorizer } from "@/modules/announcement/attachment-authorizer";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { AnnouncementNotificationHandler } from "@/modules/outbox/handlers/announcement-notification-handler";
import { OutboxHandlerRegistry } from "@/modules/outbox/outbox-handler-registry";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

const prisma = getPrismaClient();
const service = new AnnouncementService();
let adminA: PermissionActor;
let adminB: PermissionActor;
let recipientA: PermissionActor;
let recipientB: PermissionActor;
let attachmentId: string;

async function fixture(role: RoleCode): Promise<PermissionActor> {
  const person = await prisma.person.create({ data: { name: `Announcement ${role} ${randomUUID()}` } });
  const account = await prisma.account.create({ data: {
    personId: person.id,
    phone: `139${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    passwordHash: "database-test-only",
    status: "NORMAL",
    confidentialityConfirmedAt: new Date(),
  } });
  await prisma.roleAssignment.create({ data: { personId: person.id, roleCode: role, effectiveAt: new Date(Date.now() - 60_000), grantedByPersonId: person.id, reason: "database fixture" } });
  const roles = [role];
  return {
    personId: person.id,
    accountId: account.id,
    accountStatus: "NORMAL",
    permissionVersion: BigInt(1),
    effectiveRoles: roles,
    capabilities: resolveCapabilities(roles, new Set()),
    specialPermissions: new Set(),
    selfPersonId: person.id,
    townshipAreaIds: [], departmentAreaIds: [], hasGlobalPublished: true,
    hasGlobalOperational: role === "ADMIN" || role === "SUPER_ADMIN",
    hasSystem: role === "SUPER_ADMIN", currentBatchMember: false, configurationIssues: [],
  };
}

async function dispatchAnnouncementEvents(announcementId: string, twice = false) {
  const registry = new OutboxHandlerRegistry();
  for (const type of ["ANNOUNCEMENT_PUBLISHED", "ANNOUNCEMENT_UPDATED", "ANNOUNCEMENT_AUDIENCE_ADDED", "ANNOUNCEMENT_AUDIENCE_REMOVED", "ANNOUNCEMENT_WITHDRAWN"] as const) {
    registry.register(type, new AnnouncementNotificationHandler(type));
  }
  const events = await prisma.outboxEvent.findMany({ where: { aggregateType: "ANNOUNCEMENT", aggregateId: announcementId, publishedAt: null }, orderBy: { occurredAt: "asc" } });
  for (const event of events) {
    await prisma.$transaction((tx) => registry.dispatch(event, tx));
    if (twice) await prisma.$transaction((tx) => registry.dispatch(event, tx));
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date() } });
  }
}

beforeAll(async () => {
  [adminA, adminB, recipientA, recipientB] = await Promise.all([
    fixture("ADMIN"), fixture("ADMIN"), fixture("MEMBER_ALUMNI_PLATFORM"), fixture("MEMBER_ALUMNI_PLATFORM"),
  ]);
  const attachment = await prisma.attachment.create({ data: {
    originalFilename: "announcement.pdf", extension: "pdf", declaredMimeType: "application/pdf",
    expectedSizeBytes: BigInt(8), actualSizeBytes: BigInt(8), bucket: "test", region: "test",
    objectKey: `announcement/${randomUUID()}.pdf`, uploadStatus: "UPLOADED", scanStatus: "PASSED",
    isTemporary: true, uploadedByPersonId: adminA.personId,
  } });
  attachmentId = attachment.id;
});

afterAll(async () => { await prisma.$disconnect(); });

describe("C-M3-003 announcement, message and todo on real MySQL", () => {
  it("preserves versions, confirmation history, audience access and idempotent notification writes", async () => {
    const created = await service.create({ actor: adminA, body: {
      title: "需确认的重要公告", body: "第一版正文", isImportant: true, needConfirm: true,
      attachmentIds: [attachmentId], audience: [{ type: "PERSON", personId: recipientA.personId }],
    } });
    await service.publish({ actor: adminA, announcementId: created.id });
    await dispatchAnnouncementEvents(created.id, true);
    expect(await prisma.message.count({ where: { personId: recipientA.personId, aggregateId: created.id } })).toBe(1);
    expect(await prisma.todo.count({ where: { personId: recipientA.personId, aggregateId: created.id, status: "OPEN" } })).toBe(1);

    const confirms = await Promise.all(Array.from({ length: 10 }, () => service.confirm({ actor: recipientA, announcementId: created.id })));
    expect(new Set(confirms.map(({ confirmedAt }) => confirmedAt.getTime())).size).toBe(1);
    const v1 = await prisma.announcement.findUniqueOrThrow({ where: { id: created.id }, include: { currentVersion: true } });
    expect(await prisma.announcementRecipientState.count({ where: { versionId: v1.currentVersionId!, personId: recipientA.personId, confirmedAt: { not: null } } })).toBe(1);
    expect(await prisma.todo.count({ where: { personId: recipientA.personId, aggregateId: created.id, status: "COMPLETED" } })).toBe(1);

    await service.update({ actor: adminA, announcementId: created.id, body: {
      title: "需确认的重要公告", body: "第二版正文", isImportant: true, needConfirm: true,
      attachmentIds: [attachmentId], reason: "发布更新版本",
    } });
    await dispatchAnnouncementEvents(created.id, true);
    const versions = await prisma.announcementVersion.findMany({ where: { announcementId: created.id }, orderBy: { versionNo: "asc" }, include: { recipientStates: true } });
    expect(versions).toHaveLength(2);
    expect(versions[0].recipientStates[0].confirmedAt).not.toBeNull();
    expect(versions[1].recipientStates[0].confirmedAt).toBeNull();
    expect(await prisma.todo.count({ where: { personId: recipientA.personId, aggregateId: created.id, status: "OPEN" } })).toBe(1);

    await service.updateAudience({ actor: adminA, announcementId: created.id, body: {
      audience: [{ type: "PERSON", personId: recipientA.personId }, { type: "PERSON", personId: recipientB.personId }],
      reason: "增加接收人",
    } });
    await dispatchAnnouncementEvents(created.id, true);
    await expect(service.detail({ actor: recipientB, announcementId: created.id })).resolves.toMatchObject({ id: created.id });
    expect(await prisma.message.count({ where: { personId: recipientB.personId, aggregateId: created.id } })).toBe(1);
    expect(await prisma.todo.count({ where: { personId: recipientB.personId, aggregateId: created.id, status: "OPEN" } })).toBe(1);

    await service.updateAudience({ actor: adminA, announcementId: created.id, body: {
      audience: [{ type: "PERSON", personId: recipientB.personId }], reason: "缩小接收范围",
    } });
    await dispatchAnnouncementEvents(created.id, true);
    await expect(service.detail({ actor: recipientA, announcementId: created.id })).rejects.toMatchObject({ code: "ANNOUNCEMENT_NOT_FOUND" });
    expect(await prisma.todo.count({ where: { personId: recipientA.personId, aggregateId: created.id, status: "STALE" } })).toBe(1);
    expect(versions[0].recipientStates[0].confirmedAt).not.toBeNull();
    const registry = new AttachmentParentAuthorizerRegistry();
    registerAnnouncementAttachmentAuthorizer(registry);
    await expect(registry.authorizeAll({ actor: recipientA, links: [{ entityType: "ANNOUNCEMENT_VERSION", entityId: versions[1].id, relationType: "ATTACHMENT" }], action: "PREVIEW" })).resolves.toBe(false);
  });

  it("serializes concurrent pin replacement to exactly one current pin", async () => {
    const make = async (title: string) => {
      const item = await service.create({ actor: adminA, body: { title, body: title, isImportant: false, needConfirm: false, attachmentIds: [], audience: [{ type: "PERSON", personId: recipientB.personId }] } });
      await service.publish({ actor: adminA, announcementId: item.id });
      return item.id;
    };
    const [a, b] = await Promise.all([make("并发置顶 A"), make("并发置顶 B")]);
    await Promise.all([service.pin({ actor: adminA, announcementId: a, body: { pinned: true } }), service.pin({ actor: adminB, announcementId: b, body: { pinned: true } })]);
    expect(await prisma.announcement.count({ where: { pinnedKey: 1, isPinned: true, status: "PUBLISHED" } })).toBe(1);
  });
});
