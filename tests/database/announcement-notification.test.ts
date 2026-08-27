import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { AnnouncementService } from "@/modules/announcement/announcement-service";
import { registerAnnouncementAttachmentAuthorizer } from "@/modules/announcement/attachment-authorizer";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { NotificationService } from "@/modules/notification/notification-service";
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

async function createAttachment(uploadedByPersonId: string, data: { isTemporary?: boolean; permissionLevel?: "PARENT_AUTHORIZED" | "SENSITIVE_PARENT" } = {}) {
  return prisma.attachment.create({ data: {
    originalFilename: `announcement-${randomUUID()}.pdf`, extension: "pdf", declaredMimeType: "application/pdf",
    expectedSizeBytes: BigInt(8), actualSizeBytes: BigInt(8), bucket: "test", region: "test",
    objectKey: `announcement/${randomUUID()}.pdf`, uploadStatus: "UPLOADED", scanStatus: "PASSED",
    isTemporary: data.isTemporary ?? true,
    permissionLevel: data.permissionLevel ?? "PARENT_AUTHORIZED",
    uploadedByPersonId,
  } });
}

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
    expect(await prisma.auditLog.count({ where: { entityId: created.id, actionCode: "ANNOUNCEMENT_VERSION_CREATED" } })).toBe(1);
    await service.publish({ actor: adminA, announcementId: created.id });
    await dispatchAnnouncementEvents(created.id, true);
    expect(await prisma.message.count({ where: { personId: recipientA.personId, aggregateId: created.id } })).toBe(1);
    expect(await prisma.todo.count({ where: { personId: recipientA.personId, aggregateId: created.id, status: "OPEN" } })).toBe(1);

    const [firstRead, repeatedRead] = await Promise.all([
      service.read({ actor: recipientA, announcementId: created.id }),
      service.read({ actor: recipientA, announcementId: created.id }),
    ]);
    expect(firstRead.readAt.getTime()).toBe(repeatedRead.readAt.getTime());
    expect(await prisma.auditLog.count({ where: { entityId: created.id, actorPersonId: recipientA.personId, actionCode: "ANNOUNCEMENT_READ" } })).toBe(1);

    const confirms = await Promise.all(Array.from({ length: 10 }, () => service.confirm({ actor: recipientA, announcementId: created.id })));
    expect(new Set(confirms.map(({ confirmedAt }) => confirmedAt.getTime())).size).toBe(1);
    const v1 = await prisma.announcement.findUniqueOrThrow({ where: { id: created.id }, include: { currentVersion: true } });
    expect(await prisma.announcementRecipientState.count({ where: { versionId: v1.currentVersionId!, personId: recipientA.personId, confirmedAt: { not: null } } })).toBe(1);
    expect(await prisma.todo.count({ where: { personId: recipientA.personId, aggregateId: created.id, status: "COMPLETED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: created.id, actorPersonId: recipientA.personId, actionCode: "ANNOUNCEMENT_CONFIRMED" } })).toBe(1);

    await service.update({ actor: adminA, announcementId: created.id, body: {
      title: "需确认的重要公告", body: "第二版正文", isImportant: true, needConfirm: true,
      attachmentIds: [attachmentId], reason: "发布更新版本",
    } });
    await dispatchAnnouncementEvents(created.id, true);
    const versions = await prisma.announcementVersion.findMany({ where: { announcementId: created.id }, orderBy: { versionNo: "asc" }, include: { recipientStates: true } });
    expect(versions).toHaveLength(2);
    expect(await prisma.attachmentLink.count({ where: { attachmentId, entityType: "ANNOUNCEMENT_VERSION", entityId: { in: versions.map(({ id }) => id) } } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { entityId: created.id, actionCode: "ANNOUNCEMENT_VERSION_CREATED" } })).toBe(2);
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

  it("accepts only actor-owned temporary uploads or history from the same announcement", async () => {
    const own = await createAttachment(adminA.personId);
    const item = await service.create({ actor: adminA, body: {
      title: "附件边界公告", body: "第一版", attachmentIds: [own.id], audience: [{ type: "PERSON", personId: recipientA.personId }],
    } });
    const v1 = item.currentVersion.id;
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ isTemporary: false, permissionLevel: "PARENT_AUTHORIZED" });

    const updated = await service.update({ actor: adminA, announcementId: item.id, body: {
      title: "附件边界公告", body: "第二版", attachmentIds: [own.id], reason: "沿用历史附件",
    } });
    const v2 = updated.currentVersion.id;
    expect(await prisma.attachmentLink.findMany({
      where: { attachmentId: own.id, entityType: "ANNOUNCEMENT_VERSION" },
      orderBy: { entityId: "asc" }, select: { entityId: true },
    })).toEqual([{ entityId: v1 }, { entityId: v2 }].sort((left, right) => left.entityId.localeCompare(right.entityId)));

    const foreignTemporary = await createAttachment(adminB.personId);
    const beforeForeign = await prisma.attachment.findUniqueOrThrow({ where: { id: foreignTemporary.id }, include: { links: true } });
    await expect(service.update({ actor: adminA, announcementId: item.id, body: {
      title: "拒绝其他管理员附件", body: "第三版", attachmentIds: [foreignTemporary.id], reason: "负向测试",
    } })).rejects.toMatchObject({ code: "ANNOUNCEMENT_ATTACHMENT_INVALID", status: 422 });
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: foreignTemporary.id }, include: { links: true } })).toEqual(beforeForeign);

    const helpAttachment = await createAttachment(adminA.personId, { isTemporary: false, permissionLevel: "SENSITIVE_PARENT" });
    await prisma.attachmentLink.create({ data: {
      attachmentId: helpAttachment.id, entityType: "HELP_REQUEST", entityId: randomUUID(), relationType: "ATTACHMENT", createdByPersonId: adminA.personId,
    } });
    const beforeHelp = await prisma.attachment.findUniqueOrThrow({ where: { id: helpAttachment.id }, include: { links: true } });
    await expect(service.update({ actor: adminA, announcementId: item.id, body: {
      title: "拒绝 Help 附件", body: "第三版", attachmentIds: [helpAttachment.id], reason: "负向测试",
    } })).rejects.toMatchObject({ code: "ANNOUNCEMENT_ATTACHMENT_INVALID", status: 422 });
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: helpAttachment.id }, include: { links: true } })).toEqual(beforeHelp);

    const otherAttachment = await createAttachment(adminA.personId);
    const other = await service.create({ actor: adminA, body: {
      title: "其他公告", body: "其他公告正文", attachmentIds: [otherAttachment.id], audience: [{ type: "PERSON", personId: recipientA.personId }],
    } });
    const beforeOther = await prisma.attachment.findUniqueOrThrow({ where: { id: otherAttachment.id }, include: { links: true } });
    await expect(service.update({ actor: adminA, announcementId: item.id, body: {
      title: "拒绝其他公告附件", body: "第三版", attachmentIds: [otherAttachment.id], reason: "负向测试",
    } })).rejects.toMatchObject({ code: "ANNOUNCEMENT_ATTACHMENT_INVALID", status: 422 });
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: otherAttachment.id }, include: { links: true } })).toEqual(beforeOther);
    expect(await prisma.announcementVersion.count({ where: { announcementId: item.id } })).toBe(2);
    expect(await prisma.announcementVersion.count({ where: { announcementId: other.id } })).toBe(1);
  });

  it("keeps an announcement draft when its audience resolves to no enabled account", async () => {
    const disabled = await fixture("MEMBER_ALUMNI_PLATFORM");
    await prisma.account.update({ where: { id: disabled.accountId }, data: { status: "DISABLED" } });
    const item = await service.create({ actor: adminA, body: {
      title: "空接收人公告", body: "不得发布", attachmentIds: [], audience: [{ type: "PERSON", personId: disabled.personId }],
    } });
    await expect(service.publish({ actor: adminA, announcementId: item.id })).rejects.toMatchObject({
      code: "ANNOUNCEMENT_AUDIENCE_EMPTY", status: 422,
    });
    expect(await prisma.announcement.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "DRAFT", publishedAt: null, publishedByPersonId: null });
    expect(await prisma.announcementRecipientState.count({ where: { versionId: item.currentVersion.id } })).toBe(0);
    expect(await prisma.stateTransitionHistory.count({ where: { entityType: "ANNOUNCEMENT", entityId: item.id, actionCode: "ANNOUNCEMENT_PUBLISHED" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: item.id, actionCode: "ANNOUNCEMENT_PUBLISHED" } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateType: "ANNOUNCEMENT", aggregateId: item.id, eventType: "ANNOUNCEMENT_PUBLISHED" } })).toBe(0);
  });

  it("filters only the actor's messages and exposes isolated unread/open counts", async () => {
    const actor = await fixture("MEMBER_ALUMNI_PLATFORM");
    const other = await fixture("MEMBER_ALUMNI_PLATFORM");
    const notifications = new NotificationService();
    const now = new Date();
    const [helpUnread, tripRead] = await Promise.all([
      prisma.message.create({ data: { personId: actor.personId, messageType: "HELP_REOPENED", title: "Help", summary: "Help", aggregateType: "HELP_REQUEST", aggregateId: randomUUID(), dedupeKey: `counts-help:${randomUUID()}`, eventAt: now } }),
      prisma.message.create({ data: { personId: actor.personId, messageType: "TRIP_UPDATED", title: "Trip", summary: "Trip", aggregateType: "TRIP", aggregateId: randomUUID(), dedupeKey: `counts-trip:${randomUUID()}`, eventAt: now, readAt: now } }),
      prisma.message.create({ data: { personId: other.personId, messageType: "HELP_REOPENED", title: "Other", summary: "Other", aggregateType: "HELP_REQUEST", aggregateId: randomUUID(), dedupeKey: `counts-other:${randomUUID()}`, eventAt: now } }),
    ]);
    const openTodo = await prisma.todo.create({ data: { personId: actor.personId, todoType: "TEST_OPEN", module: "HELP", aggregateType: "HELP_REQUEST", aggregateId: randomUUID(), actionUrl: "/todos", dedupeKey: `counts-open:${randomUUID()}` } });
    await prisma.todo.create({ data: { personId: actor.personId, todoType: "TEST_DONE", module: "HELP", aggregateType: "HELP_REQUEST", aggregateId: randomUUID(), actionUrl: "/todos", dedupeKey: `counts-done:${randomUUID()}`, status: "COMPLETED", completedAt: now } });
    await prisma.todo.create({ data: { personId: other.personId, todoType: "TEST_OTHER", module: "HELP", aggregateType: "HELP_REQUEST", aggregateId: randomUUID(), actionUrl: "/todos", dedupeKey: `counts-other-todo:${randomUUID()}` } });

    expect(await notifications.getCounts(actor)).toEqual({ unreadMessageCount: 1, openTodoCount: 1 });
    expect((await notifications.listMessages({ actor, query: { unread: true } })).items.map(({ id }) => id)).toEqual([helpUnread.id]);
    expect((await notifications.listMessages({ actor, query: { unread: false } })).items.map(({ id }) => id)).toEqual([tripRead.id]);
    expect((await notifications.listMessages({ actor, query: { type: "HELP_REOPENED" } })).items.map(({ id }) => id)).toEqual([helpUnread.id]);
    expect((await notifications.listMessages({ actor, query: { module: "TRIP" } })).items.map(({ id }) => id)).toEqual([tripRead.id]);
    expect((await notifications.listMessages({ actor, query: { unread: true, type: "HELP_REOPENED", module: "HELP" } })).items.map(({ id }) => id)).toEqual([helpUnread.id]);
    await expect(notifications.listMessages({ actor, query: { module: "UNKNOWN" } })).rejects.toMatchObject({ name: "ZodError" });

    await notifications.readMessage({ actor, messageId: helpUnread.id });
    expect(await notifications.getCounts(actor)).toEqual({ unreadMessageCount: 0, openTodoCount: 1 });
    await Promise.all(Array.from({ length: 2 }, (_, index) => prisma.message.create({ data: {
      personId: actor.personId, messageType: "TEST", title: `Unread ${index}`, summary: "Unread", dedupeKey: `counts-unread:${randomUUID()}`, eventAt: now,
    } })));
    expect((await notifications.readAll({ actor })).updated).toBe(2);
    expect((await notifications.getCounts(actor)).unreadMessageCount).toBe(0);
    await prisma.todo.update({ where: { id: openTodo.id }, data: { status: "COMPLETED", completedAt: now } });
    expect((await notifications.getCounts(actor)).openTodoCount).toBe(0);
    const staleTodo = await prisma.todo.create({ data: { personId: actor.personId, todoType: "TEST_STALE", module: "TRIP", aggregateType: "TRIP", aggregateId: randomUUID(), actionUrl: "/todos", dedupeKey: `counts-stale:${randomUUID()}` } });
    expect((await notifications.getCounts(actor)).openTodoCount).toBe(1);
    await prisma.todo.update({ where: { id: staleTodo.id }, data: { status: "STALE", staleAt: now } });
    expect((await notifications.getCounts(actor)).openTodoCount).toBe(0);
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
