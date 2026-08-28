import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { DemandLifecycleService, DemandOutcomeService, shanghaiDateString } from "@/modules/demand";
import { registerDemandAttachmentAuthorizers } from "@/modules/demand/attachment-authorization";
import { DemandOutcomeDueJobHandler } from "@/modules/jobs/handlers/demand-outcome-due-handler";
import { DEMAND_LIFECYCLE_NOTIFICATION_EVENTS, DemandProgressCloseNotificationHandler } from "@/modules/outbox/handlers/demand-progress-close-notification-handler";
import { OutboxHandlerRegistry } from "@/modules/outbox/outbox-handler-registry";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

const prisma = getPrismaClient();
const lifecycle = new DemandLifecycleService();
const outcome = new DemandOutcomeService();
const previousCurrentBatchIds: string[] = [];
let batchId: string;
let areaId: string;
let organizationId: string;
let enterpriseId: string;
let contactId: string;
let creatorId: string;
let phone = 17750000000;

function day(offset: number): string {
  return shanghaiDateString(new Date(Date.now() + offset * 86_400_000));
}

async function actorFixture(roles: RoleCode[], overrides: Partial<PermissionActor> = {}) {
  const person = await prisma.person.create({ data: { name: `M1-007-${roles.join("+")}-${randomUUID()}` } });
  const account = await prisma.account.create({ data: { personId: person.id, phone: String(phone++), passwordHash: "database-test-only", status: "NORMAL", forcePasswordChange: false, confidentialityConfirmedAt: new Date() } });
  await prisma.roleAssignment.createMany({ data: roles.map((roleCode) => ({ personId: person.id, roleCode, effectiveAt: new Date("2026-01-01") })) });
  if (roles.includes("TOWNSHIP_STAFF")) await prisma.appointment.create({ data: { personId: person.id, organizationId, positionTitle: "成效经办", effectiveAt: new Date("2026-01-01") } });
  if (roles.includes("MEMBER_CURRENT")) await prisma.batchMembership.create({ data: { personId: person.id, batchId, startDate: new Date("2026-01-01"), endDate: new Date("2027-12-31"), status: "ACTIVE" } });
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
    currentBatchMember: roles.includes("MEMBER_CURRENT"),
    currentBatchId: roles.includes("MEMBER_CURRENT") ? batchId : undefined,
    configurationIssues: [],
    ...overrides,
  };
  return { person, actor };
}

async function demand(status: "IN_PROGRESS" | "COMPLETED", ownerPersonId?: string) {
  const completedAt = status === "COMPLETED" ? new Date(Date.now() - 2 * 86_400_000) : undefined;
  const created = await prisma.demand.create({ data: {
    businessNo: `XQ2026${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    enterpriseId,
    responsibleAreaId: areaId,
    selectedContactId: contactId,
    title: `M1-007 成效需求 ${randomUUID()}`,
    originalDescription: "验证需求成效跟踪闭环。",
    demandType: "TECHNICAL",
    status,
    creationBatchId: batchId,
    currentFollowBatchId: batchId,
    currentOwnerPersonId: ownerPersonId,
    firstPublishedAt: new Date(Date.now() - 10 * 86_400_000),
    completedAt,
    completionBatchId: status === "COMPLETED" ? batchId : undefined,
    createdByPersonId: creatorId,
  } });
  if (ownerPersonId) await prisma.demandOwnerHistory.create({ data: { demandId: created.id, personId: ownerPersonId, batchId, changeType: "CLAIM", createdByPersonId: ownerPersonId, effectiveAt: new Date(Date.now() - 10 * 86_400_000), activeKey: 1 } });
  return created;
}

const roundBody = (overrides: Record<string, unknown> = {}) => ({
  trackingDate: day(-1),
  contractAmountIncrement: "100.25",
  investmentAmountIncrement: "0",
  policyFundIncrement: "0",
  costReductionIncrement: "0",
  talentIntroducedIncrement: 0,
  patentIncrement: 0,
  qualitativeResult: "完成首轮技术验证",
  endTracking: false,
  nextTrackingDate: day(0),
  attachmentIds: [],
  ...overrides,
});

async function deliverOutcomeEvents(demandId: string) {
  const registry = new OutboxHandlerRegistry();
  for (const eventType of DEMAND_LIFECYCLE_NOTIFICATION_EVENTS) registry.register(eventType, new DemandProgressCloseNotificationHandler(eventType));
  const events = await prisma.outboxEvent.findMany({ where: { aggregateId: demandId, eventType: { in: [...DEMAND_LIFECYCLE_NOTIFICATION_EVENTS] } } });
  await prisma.$transaction(async (tx) => { for (const event of events) await registry.dispatch(event, tx); });
}

beforeAll(async () => {
  previousCurrentBatchIds.push(...(await prisma.batch.findMany({ where: { isCurrent: true }, select: { id: true } })).map(({ id }) => id));
  await prisma.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
  const creator = await prisma.person.create({ data: { name: `M1-007 fixture ${randomUUID()}` } });
  creatorId = creator.id;
  const [batch, area, organization] = await Promise.all([
    prisma.batch.create({ data: { name: `M1-007 当前批次 ${randomUUID()}`, year: 2026, startDate: new Date("2026-01-01"), endDate: new Date("2027-12-31"), status: "ACTIVE", isCurrent: true } }),
    prisma.administrativeArea.create({ data: { name: `M1-007 区域 ${randomUUID()}`, type: "TOWNSHIP" } }),
    prisma.organization.create({ data: { name: `M1-007 镇区组织 ${randomUUID()}`, type: "TOWNSHIP_ORG", status: "ACTIVE" } }),
  ]);
  batchId = batch.id;
  areaId = area.id;
  organizationId = organization.id;
  await prisma.organizationAreaMapping.create({ data: { organizationId, areaId, effectiveAt: new Date("2026-01-01") } });
  const enterprise = await prisma.enterprise.create({ data: { name: `M1-007 企业 ${randomUUID()}`, responsibleAreaId: areaId, address: "宝应县测试地址", mainProducts: "电力装备", createdByPersonId: creatorId } });
  enterpriseId = enterprise.id;
  const contact = await prisma.enterpriseContact.create({ data: { enterpriseId, name: "成效联系人", phone: "13800001707", isPrimary: true, createdByPersonId: creatorId } });
  contactId = contact.id;
  await prisma.enterprise.update({ where: { id: enterpriseId }, data: { primaryContactId: contactId } });
});

afterAll(async () => {
  await prisma.batch.updateMany({ where: { id: batchId }, data: { isCurrent: false } });
  if (previousCurrentBatchIds.length) await prisma.batch.updateMany({ where: { id: { in: previousCurrentBatchIds } }, data: { isCurrent: true } });
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.jobTask.deleteMany({ where: { jobType: "DEMAND_OUTCOME_DUE", idempotencyKey: { startsWith: "demand-outcome-due:" } } });
});

describe("A-M1-007 real MySQL outcome lifecycle", () => {
  it("creates the tracking plan atomically with close approval and rolls the close back when the plan is invalid", async () => {
    const [owner, admin] = await Promise.all([actorFixture(["MEMBER_CURRENT"]), actorFixture(["ADMIN"])]);
    const tracked = await demand("IN_PROGRESS", owner.person.id);
    await lifecycle.submitClose({ actor: owner.actor, demandId: tracked.id, idempotencyKey: randomUUID(), body: { solution: "已解决", connectedResources: "高校实验室" } });
    await lifecycle.reviewClose({ actor: admin.actor, demandId: tracked.id, body: { decision: "APPROVE", townshipVerificationResult: "属地已核实", outcomePlan: { trackingMode: "TRACKING", firstTrackingDate: day(0) } } });
    const trackedPlan = await prisma.demandOutcomePlan.findUniqueOrThrow({ where: { demandId: tracked.id } });
    expect(trackedPlan).toMatchObject({ trackingMode: "TRACKING", status: "PENDING", dueVersion: 1 });
    expect(await prisma.jobTask.count({ where: { jobType: "DEMAND_OUTCOME_DUE", idempotencyKey: `demand-outcome-due:${trackedPlan.id}:1` } })).toBe(1);

    const rollback = await demand("IN_PROGRESS", owner.person.id);
    await lifecycle.submitClose({ actor: owner.actor, demandId: rollback.id, idempotencyKey: randomUUID(), body: { solution: "拟办结", connectedResources: "技术资源" } });
    await expect(lifecycle.reviewClose({ actor: admin.actor, demandId: rollback.id, body: { decision: "APPROVE", townshipVerificationResult: "核实", outcomePlan: { trackingMode: "TRACKING", firstTrackingDate: "2020-01-01" } } })).rejects.toMatchObject({ code: "OUTCOME_STATE_CONFLICT" });
    expect(await prisma.demand.findUniqueOrThrow({ where: { id: rollback.id } })).toMatchObject({ status: "PENDING_CLOSE_REVIEW", completedAt: null, completionBatchId: null });
    expect(await prisma.demandCloseReview.count({ where: { demandId: rollback.id } })).toBe(0);
    expect(await prisma.demandOutcomePlan.count({ where: { demandId: rollback.id } })).toBe(0);
    expect(await prisma.demandCloseRequest.count({ where: { demandId: rollback.id, activeKey: 1 } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: rollback.id, eventType: "DEMAND_COMPLETED" } })).toBe(0);

    const notTracked = await demand("IN_PROGRESS", owner.person.id);
    await lifecycle.submitClose({ actor: owner.actor, demandId: notTracked.id, idempotencyKey: randomUUID(), body: { solution: "一次性解决", connectedResources: "无需持续跟踪" } });
    await lifecycle.reviewClose({ actor: admin.actor, demandId: notTracked.id, body: { decision: "APPROVE", townshipVerificationResult: "属地已核实无需跟踪", outcomePlan: { trackingMode: "NONE" } } });
    const nonePlan = await prisma.demandOutcomePlan.findUniqueOrThrow({ where: { demandId: notTracked.id } });
    expect(nonePlan).toMatchObject({ trackingMode: "NONE", status: "NOT_TRACKED", firstTrackingDate: null, nextTrackingDate: null, dueVersion: 0 });
    expect(await prisma.jobTask.count({ where: { jobType: "DEMAND_OUTCOME_DUE", idempotencyKey: { startsWith: `demand-outcome-due:${nonePlan.id}:` } } })).toBe(0);
  });

  it("creates exactly one legacy plan and one active round under concurrency", async () => {
    const [adminA, adminB, staffA, staffB] = await Promise.all([actorFixture(["ADMIN"]), actorFixture(["ADMIN"]), actorFixture(["TOWNSHIP_STAFF"]), actorFixture(["TOWNSHIP_STAFF"])]);
    const completed = await demand("COMPLETED");
    const plans = await Promise.allSettled([
      outcome.createPlan({ actor: adminA.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: { trackingMode: "TRACKING", firstTrackingDate: day(-1) } }),
      outcome.createPlan({ actor: adminB.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: { trackingMode: "TRACKING", firstTrackingDate: day(-1) } }),
    ]);
    expect(plans.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await prisma.demandOutcomePlan.count({ where: { demandId: completed.id } })).toBe(1);
    const rounds = await Promise.allSettled([
      outcome.createRound({ actor: staffA.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: roundBody() }),
      outcome.createRound({ actor: staffB.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: roundBody({ qualitativeResult: "另一工作人员旧页面" }) }),
    ]);
    expect(rounds.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await prisma.demandOutcomeRound.count({ where: { demandId: completed.id, activeKey: 1 } })).toBe(1);
  });

  it("keeps close approval, plan, and first due job exactly once under concurrent review", async () => {
    const [owner, adminA, adminB] = await Promise.all([
      actorFixture(["MEMBER_CURRENT"]),
      actorFixture(["ADMIN"]),
      actorFixture(["ADMIN"]),
    ]);
    const closing = await demand("IN_PROGRESS", owner.person.id);
    await lifecycle.submitClose({ actor: owner.actor, demandId: closing.id, idempotencyKey: randomUUID(), body: { solution: "已解决", connectedResources: "项目资源" } });
    const body = { decision: "APPROVE", townshipVerificationResult: "属地已核实", outcomePlan: { trackingMode: "TRACKING", firstTrackingDate: day(0) } } as const;
    const approvals = await Promise.allSettled([
      lifecycle.reviewClose({ actor: adminA.actor, demandId: closing.id, body }),
      lifecycle.reviewClose({ actor: adminB.actor, demandId: closing.id, body }),
    ]);
    expect(approvals.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const plan = await prisma.demandOutcomePlan.findUniqueOrThrow({ where: { demandId: closing.id } });
    expect(await prisma.demandCloseReview.count({ where: { demandId: closing.id, decision: "APPROVE" } })).toBe(1);
    expect(await prisma.demandOutcomePlan.count({ where: { demandId: closing.id } })).toBe(1);
    expect(await prisma.jobTask.count({ where: { jobType: "DEMAND_OUTCOME_DUE", idempotencyKey: `demand-outcome-due:${plan.id}:1` } })).toBe(1);
  });

  it("prevents lost updates, excludes returned values from totals, preserves tracking batch, and ends cleanly", async () => {
    const [admin, staffA, staffB] = await Promise.all([actorFixture(["ADMIN"]), actorFixture(["TOWNSHIP_STAFF"]), actorFixture(["TOWNSHIP_STAFF"])]);
    const completed = await demand("COMPLETED");
    await outcome.createPlan({ actor: admin.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: { trackingMode: "TRACKING", firstTrackingDate: day(-1) } });
    const created = await outcome.createRound({ actor: staffA.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: roundBody() });
    const updates = await Promise.allSettled([
      outcome.updateRound({ actor: staffA.actor, roundId: created.roundId, body: { ...roundBody({ qualitativeResult: "A 更新" }), expectedVersion: 1 } }),
      outcome.updateRound({ actor: staffB.actor, roundId: created.roundId, body: { ...roundBody({ qualitativeResult: "B 更新" }), expectedVersion: 1 } }),
    ]);
    expect(updates.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const version = (await prisma.demandOutcomeRound.findUniqueOrThrow({ where: { id: created.roundId } })).editVersion;
    await outcome.submitRound({ actor: staffA.actor, roundId: created.roundId, idempotencyKey: randomUUID(), body: { expectedVersion: version } });
    await outcome.reviewRound({ actor: admin.actor, roundId: created.roundId, idempotencyKey: randomUUID(), body: { decision: "RETURN", reason: "需补充企业确认" } });
    expect((await outcome.overview({ actor: admin.actor, demandId: completed.id })).approvedTotals.contractAmount).toBe("0.00");
    const returned = await prisma.demandOutcomeRound.findUniqueOrThrow({ where: { id: created.roundId } });
    await outcome.updateRound({ actor: staffB.actor, roundId: created.roundId, body: { ...roundBody({ contractAmountIncrement: "250.50", qualitativeResult: "已补充核验" }), expectedVersion: returned.editVersion } });
    const resubmitted = await prisma.demandOutcomeRound.findUniqueOrThrow({ where: { id: created.roundId } });
    await outcome.submitRound({ actor: staffB.actor, roundId: created.roundId, idempotencyKey: randomUUID(), body: { expectedVersion: resubmitted.editVersion } });
    await outcome.reviewRound({ actor: admin.actor, roundId: created.roundId, idempotencyKey: randomUUID(), body: { decision: "APPROVE", verifiedNote: "管理员已电话向企业核实" } });
    expect((await outcome.overview({ actor: admin.actor, demandId: completed.id })).approvedTotals.contractAmount).toBe("250.50");
    expect((await prisma.demandOutcomeRound.findUniqueOrThrow({ where: { id: created.roundId } })).trackingBatchId).toBe(batchId);

    const secondBatch = await prisma.batch.create({ data: { name: `M1-007 后续批次 ${randomUUID()}`, year: 2027, startDate: new Date("2026-01-01"), status: "ACTIVE", isCurrent: false } });
    await prisma.batch.update({ where: { id: batchId }, data: { isCurrent: false } });
    await prisma.batch.update({ where: { id: secondBatch.id }, data: { isCurrent: true } });
    const second = await outcome.createRound({ actor: staffA.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: roundBody({ trackingDate: day(0), endTracking: true, nextTrackingDate: null, qualitativeResult: "最终跟踪完成" }) });
    expect(second.trackingBatchId).toBe(secondBatch.id);
    await outcome.submitRound({ actor: staffA.actor, roundId: second.roundId, idempotencyKey: randomUUID(), body: { expectedVersion: second.editVersion } });
    await outcome.reviewRound({ actor: admin.actor, roundId: second.roundId, idempotencyKey: randomUUID(), body: { decision: "APPROVE", verifiedNote: "已线下核验最终结果" } });
    expect(await prisma.demandOutcomePlan.findUniqueOrThrow({ where: { demandId: completed.id } })).toMatchObject({ status: "ENDED", nextTrackingDate: null, endedAt: expect.any(Date) });
    const endedPlan = await prisma.demandOutcomePlan.findUniqueOrThrow({ where: { demandId: completed.id } });
    expect(await prisma.jobTask.count({ where: { jobType: "DEMAND_OUTCOME_DUE", status: "WAITING", idempotencyKey: { startsWith: `demand-outcome-due:${endedPlan.id}:` } } })).toBe(0);
    expect(await prisma.jobTask.count({ where: { jobType: "DEMAND_OUTCOME_DUE", status: "CANCELED", idempotencyKey: { startsWith: `demand-outcome-due:${endedPlan.id}:` } } })).toBe(2);
    await prisma.batch.update({ where: { id: secondBatch.id }, data: { isCurrent: false } });
    await prisma.batch.update({ where: { id: batchId }, data: { isCurrent: true } });
  }, 30_000);

  it("serializes submit versus update and approve versus return races", async () => {
    const [adminA, adminB, staffA, staffB] = await Promise.all([
      actorFixture(["ADMIN"]),
      actorFixture(["ADMIN"]),
      actorFixture(["TOWNSHIP_STAFF"]),
      actorFixture(["TOWNSHIP_STAFF"]),
    ]);

    const submitDemand = await demand("COMPLETED");
    await outcome.createPlan({ actor: adminA.actor, demandId: submitDemand.id, idempotencyKey: randomUUID(), body: { trackingMode: "TRACKING", firstTrackingDate: day(-1) } });
    const submitRound = await outcome.createRound({ actor: staffA.actor, demandId: submitDemand.id, idempotencyKey: randomUUID(), body: roundBody() });
    const submitUpdateRace = await Promise.allSettled([
      outcome.submitRound({ actor: staffA.actor, roundId: submitRound.roundId, idempotencyKey: randomUUID(), body: { expectedVersion: 1 } }),
      outcome.updateRound({ actor: staffB.actor, roundId: submitRound.roundId, body: { ...roundBody({ qualitativeResult: "并发旧页面更新" }), expectedVersion: 1 } }),
    ]);
    expect(submitUpdateRace.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const afterSubmitRace = await prisma.demandOutcomeRound.findUniqueOrThrow({ where: { id: submitRound.roundId } });
    if (afterSubmitRace.reviewStatus === "PENDING_REVIEW") expect(afterSubmitRace.qualitativeResult).toBe("完成首轮技术验证");
    else expect(afterSubmitRace).toMatchObject({ reviewStatus: "DRAFT", qualitativeResult: "并发旧页面更新", editVersion: 2 });

    const reviewDemand = await demand("COMPLETED");
    await outcome.createPlan({ actor: adminA.actor, demandId: reviewDemand.id, idempotencyKey: randomUUID(), body: { trackingMode: "TRACKING", firstTrackingDate: day(-1) } });
    const reviewRound = await outcome.createRound({ actor: staffA.actor, demandId: reviewDemand.id, idempotencyKey: randomUUID(), body: roundBody() });
    await outcome.submitRound({ actor: staffA.actor, roundId: reviewRound.roundId, idempotencyKey: randomUUID(), body: { expectedVersion: 1 } });
    const reviewRace = await Promise.allSettled([
      outcome.reviewRound({ actor: adminA.actor, roundId: reviewRound.roundId, idempotencyKey: randomUUID(), body: { decision: "APPROVE", verifiedNote: "管理员 A 已核实" } }),
      outcome.reviewRound({ actor: adminB.actor, roundId: reviewRound.roundId, idempotencyKey: randomUUID(), body: { decision: "RETURN", reason: "管理员 B 要求补充" } }),
    ]);
    expect(reviewRace.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const afterReviewRace = await prisma.demandOutcomeRound.findUniqueOrThrow({ where: { id: reviewRound.roundId } });
    expect(["APPROVED", "RETURNED"]).toContain(afterReviewRace.reviewStatus);
    if (afterReviewRace.reviewStatus === "APPROVED") expect(afterReviewRace.activeKey).toBeNull();
    else expect(afterReviewRace.activeKey).toBe(1);
    const reviewPlan = await prisma.demandOutcomePlan.findUniqueOrThrow({ where: { demandId: reviewDemand.id } });
    expect(await prisma.jobTask.count({ where: { jobType: "DEMAND_OUTCOME_DUE", idempotencyKey: { startsWith: `demand-outcome-due:${reviewPlan.id}:` } } })).toBe(afterReviewRace.reviewStatus === "APPROVED" ? 2 : 1);
  }, 30_000);

  it("enforces the full fill and review role matrix", async () => {
    const actors = await Promise.all([
      actorFixture(["ADMIN"]),
      actorFixture(["SUPER_ADMIN"]),
      actorFixture(["TOWNSHIP_STAFF"]),
      actorFixture(["TOWNSHIP_STAFF"], { townshipAreaIds: [] }),
      actorFixture(["MEMBER_CURRENT"]),
      actorFixture(["MEMBER_ALUMNI_PLATFORM"]),
      actorFixture(["GROUP_LEADER"]),
      actorFixture(["MINISTER"]),
      actorFixture(["DEPARTMENT_STAFF"]),
      actorFixture(["ADMIN", "TOWNSHIP_STAFF"]),
    ]);
    const [admin, superAdmin, responsibleTownship, otherTownship, member, alumni, leader, minister, department, dualRole] = actors;
    const completed = await demand("COMPLETED");
    await outcome.createPlan({ actor: admin.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: { trackingMode: "TRACKING", firstTrackingDate: day(-1) } });

    for (const allowed of [responsibleTownship, dualRole]) {
      expect((await outcome.overview({ actor: allowed.actor, demandId: completed.id })).permissions.canCreateRound).toBe(true);
    }
    for (const denied of [otherTownship, member, alumni, leader, minister, department, admin, superAdmin]) {
      expect((await outcome.overview({ actor: denied.actor, demandId: completed.id })).permissions.canCreateRound).toBe(false);
    }
    expect((await outcome.overview({ actor: admin.actor, demandId: completed.id })).permissions.canReview).toBe(true);
    expect((await outcome.overview({ actor: superAdmin.actor, demandId: completed.id })).permissions.canReview).toBe(true);
    expect((await outcome.overview({ actor: responsibleTownship.actor, demandId: completed.id })).permissions.canReview).toBe(false);
  });

  it("makes stale due jobs no-op and deduplicates due Message/Todo delivery", async () => {
    const [admin, staff] = await Promise.all([actorFixture(["ADMIN"]), actorFixture(["TOWNSHIP_STAFF"])]);
    const completed = await demand("COMPLETED");
    const plan = await outcome.createPlan({ actor: admin.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: { trackingMode: "TRACKING", firstTrackingDate: day(-1) } });
    const handler = new DemandOutcomeDueJobHandler(prisma, () => new Date());
    await handler.handle({ planId: plan.id, dueVersion: 99, dueDate: day(-1), eventKey: "stale" });
    expect(await prisma.outboxEvent.count({ where: { aggregateId: completed.id, eventType: "OUTCOME_TRACKING_DUE" } })).toBe(0);
    const payload = { planId: plan.id, dueVersion: 1, dueDate: day(-1), eventKey: `outcome-due:${plan.id}:1` };
    await handler.handle(payload);
    await handler.handle(payload);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: completed.id, eventType: "OUTCOME_TRACKING_DUE" } })).toBe(1);
    await deliverOutcomeEvents(completed.id);
    await deliverOutcomeEvents(completed.id);
    expect(await prisma.message.count({ where: { aggregateId: completed.id, personId: staff.person.id, messageType: "OUTCOME_TRACKING_DUE" } })).toBe(1);
    expect(await prisma.todo.count({ where: { aggregateId: completed.id, personId: staff.person.id, todoType: "OUTCOME_FILL", status: "OPEN" } })).toBe(1);

    const activeDemand = await demand("COMPLETED");
    const activePlan = await outcome.createPlan({ actor: admin.actor, demandId: activeDemand.id, idempotencyKey: randomUUID(), body: { trackingMode: "TRACKING", firstTrackingDate: day(-1) } });
    await outcome.createRound({ actor: staff.actor, demandId: activeDemand.id, idempotencyKey: randomUUID(), body: roundBody() });
    await handler.handle({ planId: activePlan.id, dueVersion: 1, dueDate: day(-1), eventKey: `outcome-due:${activePlan.id}:1` });
    expect(await prisma.outboxEvent.count({ where: { aggregateId: activeDemand.id, eventType: "OUTCOME_TRACKING_DUE" } })).toBe(0);
  });

  it("keeps draft evidence private, accepts only PASSED evidence, and exposes approved evidence to ordinary viewers", async () => {
    const [admin, staff, ordinary, otherTownship] = await Promise.all([actorFixture(["ADMIN"]), actorFixture(["TOWNSHIP_STAFF"]), actorFixture(["MEMBER_CURRENT"]), actorFixture(["TOWNSHIP_STAFF"], { townshipAreaIds: [] })]);
    const completed = await demand("COMPLETED");
    await outcome.createPlan({ actor: admin.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: { trackingMode: "TRACKING", firstTrackingDate: day(-1) } });
    const pending = await prisma.attachment.create({ data: { originalFilename: "pending.pdf", extension: "pdf", declaredMimeType: "application/pdf", expectedSizeBytes: BigInt(10), actualSizeBytes: BigInt(10), bucket: "test", region: "test", objectKey: `pending/${randomUUID()}`, uploadStatus: "UPLOADED", scanStatus: "PENDING", isTemporary: true, uploadedByPersonId: staff.person.id } });
    await expect(outcome.createRound({ actor: staff.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: roundBody({ attachmentIds: [pending.id] }) })).rejects.toMatchObject({ code: "OUTCOME_ATTACHMENT_INVALID" });
    const failed = await prisma.attachment.create({ data: { originalFilename: "failed.pdf", extension: "pdf", declaredMimeType: "application/pdf", expectedSizeBytes: BigInt(10), actualSizeBytes: BigInt(10), bucket: "test", region: "test", objectKey: `failed/${randomUUID()}`, uploadStatus: "UPLOADED", scanStatus: "FAILED", isTemporary: true, uploadedByPersonId: staff.person.id } });
    await expect(outcome.createRound({ actor: staff.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: roundBody({ attachmentIds: [failed.id] }) })).rejects.toMatchObject({ code: "OUTCOME_ATTACHMENT_INVALID" });
    const passed = await prisma.attachment.create({ data: { originalFilename: "passed.pdf", extension: "pdf", declaredMimeType: "application/pdf", expectedSizeBytes: BigInt(10), actualSizeBytes: BigInt(10), bucket: "test", region: "test", objectKey: `passed/${randomUUID()}`, uploadStatus: "UPLOADED", scanStatus: "PASSED", isTemporary: true, uploadedByPersonId: staff.person.id } });
    const created = await outcome.createRound({ actor: staff.actor, demandId: completed.id, idempotencyKey: randomUUID(), body: roundBody({ endTracking: true, nextTrackingDate: null, attachmentIds: [passed.id] }) });
    const link = await prisma.attachmentLink.findFirstOrThrow({ where: { attachmentId: passed.id, entityType: "DEMAND_OUTCOME_ROUND" } });
    const registry = new AttachmentParentAuthorizerRegistry();
    registerDemandAttachmentAuthorizers(registry);
    await expect(registry.authorizeAll({ actor: ordinary.actor, links: [link], action: "DOWNLOAD" })).resolves.toBe(false);
    await expect(registry.authorizeAll({ actor: staff.actor, links: [link], action: "DOWNLOAD" })).resolves.toBe(true);
    await expect(registry.authorizeAll({ actor: admin.actor, links: [link], action: "DOWNLOAD" })).resolves.toBe(true);
    await expect(registry.authorizeAll({ actor: otherTownship.actor, links: [link], action: "DOWNLOAD" })).resolves.toBe(false);

    const secondDemand = await demand("COMPLETED");
    await outcome.createPlan({ actor: admin.actor, demandId: secondDemand.id, idempotencyKey: randomUUID(), body: { trackingMode: "TRACKING", firstTrackingDate: day(-1) } });
    await expect(outcome.createRound({ actor: staff.actor, demandId: secondDemand.id, idempotencyKey: randomUUID(), body: roundBody({ attachmentIds: [passed.id] }) })).rejects.toMatchObject({ code: "OUTCOME_ATTACHMENT_INVALID" });
    await outcome.submitRound({ actor: staff.actor, roundId: created.roundId, idempotencyKey: randomUUID(), body: { expectedVersion: created.editVersion } });
    await outcome.reviewRound({ actor: admin.actor, roundId: created.roundId, idempotencyKey: randomUUID(), body: { decision: "APPROVE" } });
    await expect(registry.authorizeAll({ actor: ordinary.actor, links: [link], action: "DOWNLOAD" })).resolves.toBe(true);
    expect((await outcome.overview({ actor: ordinary.actor, demandId: completed.id })).rounds).toHaveLength(1);
  });
});
