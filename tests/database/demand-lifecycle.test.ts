import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { DemandLifecycleService, getDemandProgressFreshness } from "@/modules/demand";
import { registerDemandAttachmentAuthorizers } from "@/modules/demand/attachment-authorization";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { DEMAND_LIFECYCLE_NOTIFICATION_EVENTS, DemandProgressCloseNotificationHandler } from "@/modules/outbox/handlers/demand-progress-close-notification-handler";
import { OutboxHandlerRegistry } from "@/modules/outbox/outbox-handler-registry";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

const prisma = getPrismaClient();
const lifecycle = new DemandLifecycleService();
const previousCurrentBatchIds: string[] = [];
let batchId: string;
let areaId: string;
let enterpriseId: string;
let contactId: string;
let creatorId: string;
let organizationId: string;
let phoneSequence = 17600000000;
const oldSecret = process.env.AUTH_RATE_LIMIT_SECRET;

async function deliverLifecycleEvents(demandId: string) {
  const registry = new OutboxHandlerRegistry();
  for (const eventType of DEMAND_LIFECYCLE_NOTIFICATION_EVENTS) registry.register(eventType, new DemandProgressCloseNotificationHandler(eventType));
  const events = await prisma.outboxEvent.findMany({ where: { aggregateId: demandId, eventType: { in: [...DEMAND_LIFECYCLE_NOTIFICATION_EVENTS] } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
  await prisma.$transaction(async (tx) => {
    for (const event of events) await registry.dispatch(event, tx);
  });
}

async function actorFixture(roles: RoleCode[], current = roles.includes("MEMBER_CURRENT"), overrides: Partial<PermissionActor> = {}) {
  const person = await prisma.person.create({ data: { name: `M1-006-${roles.join("+")}-${randomUUID()}` } });
  const account = await prisma.account.create({ data: {
    personId: person.id,
    phone: String(phoneSequence++),
    passwordHash: "database-test-only",
    status: "NORMAL",
    forcePasswordChange: false,
    confidentialityConfirmedAt: new Date(),
  } });
  if (roles.length) await prisma.roleAssignment.createMany({ data: roles.map((roleCode) => ({ personId: person.id, roleCode, effectiveAt: new Date("2026-01-01") })) });
  if (current) await prisma.batchMembership.create({ data: { personId: person.id, batchId, startDate: new Date("2026-01-01"), endDate: new Date("2027-12-31"), status: "ACTIVE" } });
  const actor: PermissionActor = {
    personId: person.id,
    accountId: account.id,
    accountStatus: "NORMAL",
    permissionVersion: BigInt(1),
    effectiveRoles: roles,
    capabilities: resolveCapabilities(roles, new Set()),
    specialPermissions: new Set(),
    selfPersonId: person.id,
    townshipAreaIds: roles.includes("TOWNSHIP_STAFF") ? [areaId] : [],
    departmentAreaIds: [],
    hasGlobalPublished: true,
    hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"),
    hasSystem: roles.includes("SUPER_ADMIN"),
    currentBatchMember: current,
    currentBatchId: current ? batchId : undefined,
    configurationIssues: [],
    ...overrides,
  };
  return { person, account, actor };
}

async function inProgressDemand(ownerPersonId: string, effectiveAt = new Date()) {
  const demand = await prisma.demand.create({ data: {
    businessNo: `XQ2026${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    enterpriseId,
    responsibleAreaId: areaId,
    selectedContactId: contactId,
    title: `M1-006 生命周期需求 ${randomUUID()}`,
    originalDescription: "验证进展、办结与责任生命周期。",
    demandType: "TECHNICAL",
    urgency: "NORMAL",
    status: "IN_PROGRESS",
    creationBatchId: batchId,
    currentFollowBatchId: batchId,
    currentOwnerPersonId: ownerPersonId,
    firstPublishedAt: effectiveAt,
    createdByPersonId: creatorId,
  } });
  await prisma.demandOwnerHistory.create({ data: { demandId: demand.id, personId: ownerPersonId, batchId, effectiveAt, changeType: "CLAIM", createdByPersonId: ownerPersonId, activeKey: 1 } });
  return demand;
}

beforeAll(async () => {
  process.env.AUTH_RATE_LIMIT_SECRET = "m1-006-database-test-secret";
  previousCurrentBatchIds.push(...(await prisma.batch.findMany({ where: { isCurrent: true }, select: { id: true } })).map(({ id }) => id));
  await prisma.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
  const creator = await prisma.person.create({ data: { name: `M1-006 fixture creator ${randomUUID()}` } });
  creatorId = creator.id;
  const [batch, area] = await Promise.all([
    prisma.batch.create({ data: { name: `M1-006 当前批次 ${randomUUID()}`, year: 2026, startDate: new Date("2026-01-01"), endDate: new Date("2027-12-31"), status: "ACTIVE", isCurrent: true } }),
    prisma.administrativeArea.create({ data: { name: `M1-006 区域 ${randomUUID()}`, type: "TOWNSHIP" } }),
  ]);
  batchId = batch.id;
  areaId = area.id;
  const organization = await prisma.organization.create({ data: { name: `M1-006 属地组织 ${randomUUID()}`, type: "TOWNSHIP_ORG", status: "ACTIVE" } });
  organizationId = organization.id;
  await prisma.organizationAreaMapping.create({ data: { organizationId, areaId, effectiveAt: new Date("2026-01-01") } });
  const enterprise = await prisma.enterprise.create({ data: { name: `M1-006 企业 ${randomUUID()}`, responsibleAreaId: areaId, address: "宝应县测试地址", mainProducts: "智能制造", createdByPersonId: creator.id } });
  enterpriseId = enterprise.id;
  const contact = await prisma.enterpriseContact.create({ data: { enterpriseId, name: "M1-006 联系人", phone: "13800001606", isPrimary: true, createdByPersonId: creator.id } });
  contactId = contact.id;
  await prisma.enterprise.update({ where: { id: enterpriseId }, data: { primaryContactId: contactId } });
});

afterAll(async () => {
  process.env.AUTH_RATE_LIMIT_SECRET = oldSecret;
  await prisma.batch.updateMany({ where: { id: batchId }, data: { isCurrent: false } });
  if (previousCurrentBatchIds.length) await prisma.batch.updateMany({ where: { id: { in: previousCurrentBatchIds } }, data: { isCurrent: true } });
  await prisma.$disconnect();
});

describe("M1-006 real MySQL demand lifecycle", () => {
  it("records progress idempotently and enforces Shanghai-day reminder throttling", async () => {
    const [owner, leader] = await Promise.all([actorFixture(["MEMBER_CURRENT"]), actorFixture(["GROUP_LEADER"], false)]);
    const demand = await inProgressDemand(owner.person.id, new Date(Date.now() - 40 * 86_400_000));
    const stale = await getDemandProgressFreshness(demand.id);
    expect(stale.stale).toBe(true);
    const reminders = await Promise.allSettled(Array.from({ length: 10 }, () => lifecycle.remindStaleProgress({ actor: leader.actor, demandId: demand.id, body: {} })));
    expect(reminders.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const reminder = reminders.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof lifecycle.remindStaleProgress>>> => result.status === "fulfilled")!.value;
    expect(reminder.recipientPersonId).toBe(owner.person.id);
    await expect(lifecycle.remindStaleProgress({ actor: leader.actor, demandId: demand.id, body: {} })).rejects.toMatchObject({ code: "DEMAND_PROGRESS_REMINDER_RATE_LIMITED" });

    const evidence = await prisma.attachment.create({ data: {
      originalFilename: "m1-006-progress-proof.pdf",
      extension: "pdf",
      declaredMimeType: "application/pdf",
      expectedSizeBytes: BigInt(100),
      actualSizeBytes: BigInt(100),
      bucket: "test-private-bucket",
      region: "ap-test",
      objectKey: `m1-006/${randomUUID()}.pdf`,
      uploadStatus: "UPLOADED",
      scanStatus: "PASSED",
      isTemporary: true,
      uploadedByPersonId: owner.person.id,
    } });
    const idempotencyKey = randomUUID();
    const progressBody = { currentProgress: "已完成企业访谈", nextStep: "安排专家对接", attachmentIds: [evidence.id] };
    const progresses = await Promise.all(Array.from({ length: 20 }, () => lifecycle.addProgress({ actor: owner.actor, demandId: demand.id, idempotencyKey, body: progressBody })));
    for (const progress of progresses) expect(progress).toEqual(progresses[0]);
    expect(await prisma.demandProgress.count({ where: { demandId: demand.id } })).toBe(1);
    expect((await getDemandProgressFreshness(demand.id)).stale).toBe(false);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: demand.id, eventType: "DEMAND_PROGRESS_ADDED" } })).toBe(1);
    const progressLink = await prisma.attachmentLink.findFirstOrThrow({ where: { attachmentId: evidence.id, entityType: "DEMAND_PROGRESS" } });
    const parentAuthorizers = new AttachmentParentAuthorizerRegistry();
    registerDemandAttachmentAuthorizers(parentAuthorizers);
    await expect(parentAuthorizers.authorizeAll({ actor: owner.actor, links: [progressLink], action: "DOWNLOAD" })).resolves.toBe(true);
    await expect(parentAuthorizers.authorizeAll({ actor: { ...owner.actor, capabilities: new Set() }, links: [progressLink], action: "DOWNLOAD" })).resolves.toBe(false);
    const otherDemand = await inProgressDemand(owner.person.id);
    await expect(lifecycle.addProgress({ actor: owner.actor, demandId: otherDemand.id, idempotencyKey: randomUUID(), body: { ...progressBody, currentProgress: "伪造跨需求附件" } })).rejects.toMatchObject({ code: "DEMAND_ATTACHMENT_NOT_PASSED" });
    expect(await prisma.demandProgress.count({ where: { demandId: otherDemand.id } })).toBe(0);
    await deliverLifecycleEvents(demand.id);
    await deliverLifecycleEvents(demand.id);
    expect(await prisma.message.count({ where: { aggregateId: demand.id, personId: owner.person.id, messageType: "TEAM_COORDINATOR_STALE_REMINDER" } })).toBe(1);
    expect(await prisma.todo.findUniqueOrThrow({ where: { dedupeKey: `DEMAND:${demand.id}:DEMAND_UPDATE_STALE:${owner.person.id}` } })).toMatchObject({ status: "STALE" });
  });

  it("supports return, resubmit, and final close with immutable review history", async () => {
    const [owner, admin] = await Promise.all([actorFixture(["MEMBER_CURRENT"]), actorFixture(["ADMIN"], false)]);
    const demand = await inProgressDemand(owner.person.id);
    const first = await lifecycle.submitClose({ actor: owner.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { solution: "完成技术诊断", connectedResources: "对接高校专家" } });
    await expect(lifecycle.reviewClose({ actor: admin.actor, demandId: demand.id, body: { decision: "RETURN", townshipVerificationResult: "核验后需补充落地证明", reason: "证明不足" } })).resolves.toMatchObject({ status: "IN_PROGRESS" });
    const second = await lifecycle.submitClose({ actor: owner.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { solution: "完成技术诊断并提交证明", connectedResources: "对接高校专家和实验室" } });
    expect(second.submissionNo).toBe(first.submissionNo + 1);
    await expect(lifecycle.reviewClose({ actor: admin.actor, demandId: demand.id, body: { decision: "APPROVE", townshipVerificationResult: "企业和属地已核实完成", outcomePlan: { trackingMode: "NONE" } } })).resolves.toMatchObject({ status: "COMPLETED", completionBatchId: batchId, outcomePlan: { trackingMode: "NONE", status: "NOT_TRACKED" } });
    expect(await prisma.demandCloseRequest.count({ where: { demandId: demand.id } })).toBe(2);
    expect(await prisma.demandCloseReview.count({ where: { demandId: demand.id } })).toBe(2);
    expect(await prisma.demand.findUniqueOrThrow({ where: { id: demand.id } })).toMatchObject({ status: "COMPLETED", completedAt: expect.any(Date), completionBatchId: batchId });
    expect(await prisma.demandOutcomePlan.findUniqueOrThrow({ where: { demandId: demand.id } })).toMatchObject({ trackingMode: "NONE", status: "NOT_TRACKED", dueVersion: 0 });
    await deliverLifecycleEvents(demand.id);
    await deliverLifecycleEvents(demand.id);
    expect(await prisma.message.count({ where: { aggregateId: demand.id, personId: admin.person.id, messageType: "DEMAND_CLOSE_SUBMITTED" } })).toBe(1);
    expect(await prisma.todo.findUniqueOrThrow({ where: { dedupeKey: `DEMAND:${demand.id}:DEMAND_CLOSE_REVIEW:${admin.person.id}` } })).toMatchObject({ status: "STALE" });
  });

  it("makes close and owner-exit commands race for one legal winner, then approves exit safely", async () => {
    const [owner, admin] = await Promise.all([actorFixture(["MEMBER_CURRENT"]), actorFixture(["ADMIN"], false)]);
    const demand = await inProgressDemand(owner.person.id);
    const raced = await Promise.allSettled([
      lifecycle.submitClose({ actor: owner.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { solution: "拟办结", connectedResources: "已有资源" } }),
      lifecycle.requestOwnerExit({ actor: owner.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { reason: "工作岗位调整" } }),
    ]);
    expect(raced.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const current = await prisma.demand.findUniqueOrThrow({ where: { id: demand.id } });
    if (current.status === "PENDING_CLOSE_REVIEW") {
      await lifecycle.reviewClose({ actor: admin.actor, demandId: demand.id, body: { decision: "RETURN", townshipVerificationResult: "允许继续跟进", reason: "先调整责任" } });
      await lifecycle.requestOwnerExit({ actor: owner.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { reason: "工作岗位调整" } });
    }
    await expect(lifecycle.reviewOwnerExit({ actor: admin.actor, demandId: demand.id, body: { decision: "APPROVE", reviewReason: "同意退出并重新认领" } })).resolves.toMatchObject({ status: "PENDING_CLAIM" });
    expect(await prisma.demand.findUniqueOrThrow({ where: { id: demand.id } })).toMatchObject({ status: "PENDING_CLAIM", currentOwnerPersonId: null });
    expect(await prisma.demandOwnerHistory.count({ where: { demandId: demand.id, activeKey: 1 } })).toBe(0);
  }, 30_000);

  it("requires a fresh impact preview for SUPER transfer and keeps replay idempotent", async () => {
    const [owner, target, superAdmin, admin] = await Promise.all([
      actorFixture(["MEMBER_CURRENT"]),
      actorFixture(["MEMBER_CURRENT"]),
      actorFixture(["SUPER_ADMIN"], false),
      actorFixture(["ADMIN"], false),
    ]);
    const demand = await inProgressDemand(owner.person.id);
    await expect(lifecycle.previewOwnerTransfer({ actor: admin.actor, demandId: demand.id, body: { newOwnerPersonId: target.person.id, reason: "管理调整" } })).rejects.toMatchObject({ code: "DEMAND_OWNER_TRANSFER_FORBIDDEN" });
    const preview = await lifecycle.previewOwnerTransfer({ actor: superAdmin.actor, demandId: demand.id, body: { newOwnerPersonId: target.person.id, reason: "管理调整" } });
    const idempotencyKey = randomUUID();
    const body = { newOwnerPersonId: target.person.id, reason: "管理调整", impactToken: preview.impactToken, confirmation: "CONFIRM" };
    const transferred = await lifecycle.transferOwner({ actor: superAdmin.actor, demandId: demand.id, idempotencyKey, body });
    await expect(lifecycle.transferOwner({ actor: superAdmin.actor, demandId: demand.id, idempotencyKey, body })).resolves.toEqual(transferred);
    expect(await prisma.demand.findUniqueOrThrow({ where: { id: demand.id } })).toMatchObject({ status: "IN_PROGRESS", currentOwnerPersonId: target.person.id });
    expect(await prisma.demandOwnerHistory.count({ where: { demandId: demand.id } })).toBe(2);
    expect(await prisma.demandOwnerHistory.count({ where: { demandId: demand.id, activeKey: 1, personId: target.person.id } })).toBe(1);
  });

  it("uses the formal ALUMNI_TOWNSHIP responsibility without creating a fake owner", async () => {
    const [platform, unrelated, handler, townshipStaff, otherTownship, admin] = await Promise.all([
      actorFixture(["MEMBER_ALUMNI_PLATFORM"], false),
      actorFixture(["MEMBER_ALUMNI_PLATFORM"], false),
      actorFixture(["TOWNSHIP_STAFF"], false),
      actorFixture(["TOWNSHIP_STAFF"], false),
      actorFixture(["TOWNSHIP_STAFF"], false, { townshipAreaIds: [] }),
      actorFixture(["ADMIN"], false),
    ]);
    const historical = await prisma.person.create({ data: { name: `M1-006 历史往届 ${randomUUID()}` } });
    const demand = await prisma.demand.create({ data: {
      businessNo: `XQ2026${randomUUID().replaceAll("-", "").slice(0, 10)}`,
      enterpriseId,
      responsibleAreaId: areaId,
      selectedContactId: contactId,
      title: `M1-006 往届责任需求 ${randomUUID()}`,
      originalDescription: "验证往届镇区双责任模式。",
      demandType: "TALENT",
      urgency: "NORMAL",
      status: "IN_PROGRESS",
      creationBatchId: batchId,
      currentFollowBatchId: batchId,
      firstPublishedAt: new Date(),
      createdByPersonId: creatorId,
    } });
    const townshipHandler = await prisma.demandTownshipHandler.create({ data: { demandId: demand.id, personId: handler.person.id, organizationId, assignedByPersonId: creatorId, effectiveAt: new Date(), reason: "往届协助属地承接", activeKey: 1 } });
    await prisma.demandAlumniHelper.createMany({ data: [
      { demandId: demand.id, personId: platform.person.id, helperKind: "PLATFORM", createdByPersonId: creatorId, reason: "平台往届愿意协助", activeKey: 1 },
      { demandId: demand.id, personId: historical.id, helperKind: "HISTORICAL", createdByPersonId: creatorId, reason: "线下往届愿意协助", activeKey: 1 },
    ] });
    await expect(lifecycle.addProgress({ actor: platform.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { currentProgress: "已提供行业案例", nextStep: "协助专家筛选" } })).resolves.toMatchObject({ sourceType: "ALUMNI_PLATFORM" });
    await expect(lifecycle.addProgress({ actor: handler.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { currentProgress: "电话联系历史往届", nextStep: "整理反馈", representedPersonId: historical.id } })).resolves.toMatchObject({ sourceType: "TOWNSHIP_PROXY", representedPersonId: historical.id });
    await expect(lifecycle.addProgress({ actor: townshipStaff.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { currentProgress: "属地补充企业反馈", nextStep: "继续核实" } })).resolves.toMatchObject({ sourceType: "TOWNSHIP_STAFF" });
    await expect(lifecycle.addProgress({ actor: unrelated.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { currentProgress: "越权", nextStep: "越权" } })).rejects.toMatchObject({ code: "DEMAND_PROGRESS_NOT_ALLOWED" });
    await expect(lifecycle.addProgress({ actor: otherTownship.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { currentProgress: "越权", nextStep: "越权" } })).rejects.toMatchObject({ code: "DEMAND_PROGRESS_NOT_ALLOWED" });
    await expect(lifecycle.submitClose({ actor: townshipStaff.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { solution: "越权办结", connectedResources: "无" } })).rejects.toMatchObject({ code: "DEMAND_CLOSE_NOT_ALLOWED" });
    await lifecycle.submitClose({ actor: handler.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { solution: "往届专家已完成技术建议", connectedResources: "行业专家与高校资源" } });
    await expect(lifecycle.reviewClose({ actor: admin.actor, demandId: demand.id, body: { decision: "APPROVE", townshipVerificationResult: "属地已核实完成", outcomePlan: { trackingMode: "NONE" } } })).resolves.toMatchObject({ status: "COMPLETED" });
    expect(await prisma.demand.findUniqueOrThrow({ where: { id: demand.id } })).toMatchObject({ status: "COMPLETED", currentOwnerPersonId: null });
    expect(await prisma.demandOwnerHistory.count({ where: { demandId: demand.id } })).toBe(0);
    expect(await prisma.demandTownshipHandler.findUniqueOrThrow({ where: { id: townshipHandler.id } })).toMatchObject({ activeKey: 1, expiredAt: null });
  });

  it("cancels pending lifecycle work without counting the demand as completed", async () => {
    const [owner, admin] = await Promise.all([actorFixture(["MEMBER_CURRENT"]), actorFixture(["ADMIN"], false)]);
    const demand = await inProgressDemand(owner.person.id);
    const close = await lifecycle.submitClose({ actor: owner.actor, demandId: demand.id, idempotencyKey: randomUUID(), body: { solution: "拟办结", connectedResources: "已有资源" } });
    await expect(lifecycle.cancel({ actor: admin.actor, demandId: demand.id, body: { reason: "企业线下确认需求终止" } })).resolves.toMatchObject({ status: "CANCELED" });
    expect(await prisma.demand.findUniqueOrThrow({ where: { id: demand.id } })).toMatchObject({ status: "CANCELED", currentOwnerPersonId: null, completedAt: null, completionBatchId: null, canceledReason: "企业线下确认需求终止" });
    expect(await prisma.demandOwnerHistory.count({ where: { demandId: demand.id, activeKey: 1 } })).toBe(0);
    expect(await prisma.demandCloseRequest.findUniqueOrThrow({ where: { id: close.closeRequestId } })).toMatchObject({ activeKey: null, endedAt: expect.any(Date) });
    await deliverLifecycleEvents(demand.id);
    expect(await prisma.todo.count({ where: { aggregateId: demand.id, status: "OPEN" } })).toBe(0);
    await expect(lifecycle.cancel({ actor: admin.actor, demandId: demand.id, body: { reason: "重复取消" } })).rejects.toMatchObject({ code: "DEMAND_CANCEL_NOT_ALLOWED" });
  });
});
