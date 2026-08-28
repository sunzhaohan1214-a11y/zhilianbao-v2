import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db/prisma";
import { getDemandProgressFreshness } from "@/modules/demand";
import { HomeService } from "@/modules/home";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

const prisma = getPrismaClient();
const home = new HomeService(prisma);
const now = new Date("2099-08-28T04:00:00.000Z");
const oldCurrentBatchIds: string[] = [];
let batchId: string;
let areaId: string;
let enterpriseId: string;
let contactId: string;
let actor: PermissionActor;
let personId: string;
let creatorId: string;

function businessNo() {
  return `XQ2099${randomUUID().replaceAll("-", "").slice(0, 10)}`;
}

async function demand(status: "PENDING_CLAIM" | "IN_PROGRESS" | "PENDING_CLOSE_REVIEW", ownerPersonId?: string) {
  return prisma.demand.create({ data: {
    businessNo: businessNo(), enterpriseId, responsibleAreaId: areaId, selectedContactId: contactId,
    title: `A-M1-008 首页需求 ${randomUUID()}`, originalDescription: "真实数据库首页聚合口径验证。",
    demandType: "TECHNICAL", urgency: "NORMAL", status,
    creationBatchId: batchId, currentFollowBatchId: batchId,
    firstPublishedAt: new Date("2099-08-27T00:00:00.000Z"),
    currentOwnerPersonId: ownerPersonId, createdByPersonId: creatorId,
  } });
}

beforeAll(async () => {
  oldCurrentBatchIds.push(...(await prisma.batch.findMany({ where: { isCurrent: true }, select: { id: true } })).map(({ id }) => id));
  await prisma.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
  const [person, creator, batch, area] = await Promise.all([
    prisma.person.create({ data: { name: `A-M1-008 团长 ${randomUUID()}` } }),
    prisma.person.create({ data: { name: `A-M1-008 创建人 ${randomUUID()}` } }),
    prisma.batch.create({ data: { name: `A-M1-008 当前批次 ${randomUUID()}`, year: 2099, startDate: new Date("2099-01-01"), endDate: new Date("2100-01-01"), status: "ACTIVE", isCurrent: true } }),
    prisma.administrativeArea.create({ data: { name: `A-M1-008 区域 ${randomUUID()}`, type: "TOWNSHIP" } }),
  ]);
  personId = person.id;
  creatorId = creator.id;
  batchId = batch.id;
  areaId = area.id;
  await Promise.all([
    prisma.account.create({ data: { personId, phone: `19${Date.now().toString().slice(-9)}`, passwordHash: "database-test-only", status: "NORMAL", confidentialityConfirmedAt: now } }),
    prisma.roleAssignment.createMany({ data: ["GROUP_LEADER", "MEMBER_CURRENT"].map((roleCode) => ({ personId, roleCode: roleCode as "GROUP_LEADER" | "MEMBER_CURRENT", effectiveAt: new Date("2099-01-01") })) }),
    prisma.batchMembership.create({ data: { personId, batchId, startDate: new Date("2099-01-01"), endDate: new Date("2100-01-01"), status: "ACTIVE" } }),
  ]);
  const enterprise = await prisma.enterprise.create({ data: { name: `A-M1-008 企业 ${randomUUID()}`, responsibleAreaId: areaId, address: "宝应县测试地址", mainProducts: "智能装备", createdByPersonId: creatorId } });
  enterpriseId = enterprise.id;
  const contact = await prisma.enterpriseContact.create({ data: { enterpriseId, name: "首页联系人", phone: "13800001888", isPrimary: true, createdByPersonId: creatorId } });
  contactId = contact.id;
  await prisma.enterprise.update({ where: { id: enterpriseId }, data: { primaryContactId: contactId } });
  actor = {
    personId, accountId: (await prisma.account.findUniqueOrThrow({ where: { personId } })).id,
    accountStatus: "NORMAL", permissionVersion: BigInt(1),
    effectiveRoles: ["GROUP_LEADER", "MEMBER_CURRENT"], capabilities: resolveCapabilities(["GROUP_LEADER", "MEMBER_CURRENT"], new Set()),
    specialPermissions: new Set(), selfPersonId: personId, townshipAreaIds: [], departmentAreaIds: [],
    hasGlobalPublished: true, hasGlobalOperational: false, hasSystem: false,
    currentBatchMember: true, currentBatchId: batchId, configurationIssues: [],
  };
});

afterAll(async () => {
  await prisma.batch.updateMany({ where: { id: batchId }, data: { isCurrent: false } });
  if (oldCurrentBatchIds.length) await prisma.batch.updateMany({ where: { id: { in: oldCurrentBatchIds } }, data: { isCurrent: true } });
  await prisma.$disconnect();
});

describe("A-M1-008 real MySQL home aggregation", () => {
  it("aggregates each home source with role, visibility, limit, ranking, and stale-rule parity", async () => {
    const baseline = await home.teamOverview({ actor, now });
    const pending = await demand("PENDING_CLAIM");
    const staleDemand = await demand("IN_PROGRESS", personId);
    await demand("PENDING_CLOSE_REVIEW");
    await prisma.demandOwnerHistory.create({ data: {
      demandId: staleDemand.id, personId, batchId, effectiveAt: new Date("2099-07-27T00:00:00.000Z"),
      changeType: "CLAIM", createdByPersonId: personId, activeKey: 1,
    } });
    expect((await getDemandProgressFreshness(staleDemand.id, now)).stale).toBe(true);
    const team = await home.teamOverview({ actor, now });
    expect(team.pendingClaim - baseline.pendingClaim).toBe(1);
    expect(team.inProgress - baseline.inProgress).toBe(1);
    expect(team.pendingCloseReview - baseline.pendingCloseReview).toBe(1);
    expect(team.stale - baseline.stale).toBe(1);

    const recommendation = await prisma.demandRecommendationRun.create({ data: {
      demandId: pending.id, stage: "CURRENT", status: "SUCCEEDED", triggerType: "ADMIN", rulesVersion: "home-test", currentKey: 1,
      items: { create: { personId, candidateKind: "CURRENT", rank: 1, source: "MANUAL", reason: "首页推荐排序验证", evidenceSnapshotJson: {} } },
    } });
    expect(recommendation.id).toBeTruthy();

    const announcement = await prisma.announcement.create({ data: {
      status: "PUBLISHED", publishedAt: new Date("2099-08-27T01:00:00.000Z"), publishedByPersonId: creatorId, createdByPersonId: creatorId,
    } });
    const version = await prisma.announcementVersion.create({ data: {
      announcementId: announcement.id, versionNo: 1, title: "A-M1-008 待确认重要公告", body: "首页公告优先级验证",
      isImportant: true, needConfirm: true, createdByPersonId: creatorId,
      recipientStates: { create: { personId } },
    } });
    await prisma.announcement.update({ where: { id: announcement.id }, data: { currentVersionId: version.id } });
    const hiddenAnnouncement = await prisma.announcement.create({ data: {
      status: "PUBLISHED", publishedAt: new Date("2099-08-28T02:00:00.000Z"), publishedByPersonId: creatorId, createdByPersonId: creatorId,
    } });
    const hiddenVersion = await prisma.announcementVersion.create({ data: {
      announcementId: hiddenAnnouncement.id, versionNo: 1, title: "A-M1-008 非目标公告", body: "不得泄露给当前用户",
      isImportant: true, needConfirm: true, createdByPersonId: creatorId,
      recipientStates: { create: { personId: creatorId } },
    } });
    await prisma.announcement.update({ where: { id: hiddenAnnouncement.id }, data: { currentVersionId: hiddenVersion.id } });

    await prisma.message.createMany({ data: [
      { personId, messageType: "HOME_TEST", title: "未读一", summary: "首页未读数", dedupeKey: `home-message-${randomUUID()}`, eventAt: now },
      { personId, messageType: "HOME_TEST", title: "已读", summary: "不计入未读", dedupeKey: `home-message-${randomUUID()}`, eventAt: now, readAt: now },
    ] });

    const help = await prisma.helpRequest.create({ data: {
      businessNo: `BZ2099${randomUUID().replaceAll("-", "").slice(0, 10)}`, submitterPersonId: creatorId,
      category: "OTHER", title: "A-M1-008 紧急求助", description: "首页待办验证", urgency: "URGENT", status: "IN_PROGRESS",
      currentOwnerPersonId: personId, expectedCompleteAt: new Date("2099-08-29T00:00:00.000Z"),
    } });
    const completedHelp = await prisma.helpRequest.create({ data: {
      businessNo: `BZ2099${randomUUID().replaceAll("-", "").slice(0, 10)}`, submitterPersonId: creatorId,
      category: "OTHER", title: "A-M1-008 已完成求助", description: "过期待办必须隐藏", urgency: "NORMAL", status: "COMPLETED",
      currentOwnerPersonId: personId, expectedCompleteAt: new Date("2099-08-27T00:00:00.000Z"), completedAt: now, completionSummary: "已完成",
    } });
    await prisma.todo.createMany({ data: [
      { personId, todoType: "HELP_PROCESS", module: "help", aggregateType: "HELP_REQUEST", aggregateId: help.id, actionUrl: `/help/${help.id}`, dedupeKey: `home-todo-${randomUUID()}` },
      { personId, todoType: "HELP_PROCESS", module: "help", aggregateType: "HELP_REQUEST", aggregateId: completedHelp.id, actionUrl: `/help/${completedHelp.id}`, dedupeKey: `home-todo-${randomUUID()}` },
    ] });
    for (let index = 0; index < 3; index += 1) {
      const extraHelp = await prisma.helpRequest.create({ data: {
        businessNo: `BZ2099${randomUUID().replaceAll("-", "").slice(0, 10)}`, submitterPersonId: creatorId,
        category: "OTHER", title: `A-M1-008 普通求助 ${index}`, description: "待办上限验证", urgency: "NORMAL", status: "IN_PROGRESS",
        currentOwnerPersonId: personId, expectedCompleteAt: new Date(Date.UTC(2099, 7, 30 + index)),
      } });
      await prisma.todo.create({ data: { personId, todoType: "HELP_PROCESS", module: "help", aggregateType: "HELP_REQUEST", aggregateId: extraHelp.id, actionUrl: `/help/${extraHelp.id}`, dedupeKey: `home-todo-${randomUUID()}` } });
    }

    const alumni = await prisma.person.create({ data: { name: `A-M1-008 往届 ${randomUUID()}` } });
    const extraPresencePeople = await Promise.all(Array.from({ length: 5 }, (_, index) => prisma.person.create({ data: { name: `A-M1-008 在宝 ${index} ${randomUUID()}` } })));
    await prisma.presenceReport.createMany({ data: [
      { personId, arrivalAt: new Date("2099-08-27T00:00:00.000Z"), expectedDepartureAt: new Date("2099-08-29T00:00:00.000Z") },
      { personId: alumni.id, arrivalAt: new Date("2099-08-26T00:00:00.000Z"), expectedDepartureAt: new Date("2099-08-30T00:00:00.000Z") },
      { personId: alumni.id, arrivalAt: new Date("2099-08-25T00:00:00.000Z"), expectedDepartureAt: new Date("2099-08-31T00:00:00.000Z"), canceledAt: now, cancelReason: "取消" },
      { personId: creatorId, arrivalAt: new Date("2099-08-20T00:00:00.000Z"), expectedDepartureAt: new Date("2099-08-21T00:00:00.000Z") },
      ...extraPresencePeople.map((person, index) => ({ personId: person.id, arrivalAt: new Date(`2099-08-${20 + index}T00:00:00.000Z`), expectedDepartureAt: new Date("2099-08-31T00:00:00.000Z") })),
    ] });

    const trip = await prisma.trip.create({ data: {
      title: "A-M1-008 共享行程", purpose: "首页行程聚合验证", createdByPersonId: personId, createdAt: new Date("2099-08-20T00:00:00.000Z"),
      participants: { create: [
        { personId, isCreator: true, addedByPersonId: personId },
        { personId: alumni.id, addedByPersonId: personId },
      ] },
      nodes: { create: [
        { sequenceNo: 1, plannedStartAt: new Date("2099-08-28T01:00:00.000Z"), plannedEndAt: new Date("2099-08-28T02:00:00.000Z"), locationName: "甲地", content: "走访" },
        { sequenceNo: 2, plannedStartAt: new Date("2099-08-28T03:00:00.000Z"), plannedEndAt: new Date("2099-08-28T04:00:00.000Z"), locationName: "乙地", content: "调研" },
      ] },
    } });
    for (let index = 0; index < 3; index += 1) {
      await prisma.trip.create({ data: {
        title: `A-M1-008 行程上限 ${index}`, purpose: "首页最多三条", createdByPersonId: personId, createdAt: new Date(Date.UTC(2099, 7, 21 + index)),
        participants: { create: { personId, isCreator: true, addedByPersonId: personId } },
        nodes: { create: { sequenceNo: 1, plannedStartAt: new Date(`2099-08-28T0${5 + index}:00:00.000Z`), plannedEndAt: new Date(`2099-08-28T0${6 + index}:00:00.000Z`), locationName: `上限地点 ${index}`, content: "调研" } },
      } });
    }
    for (let index = 0; index < 3; index += 1) await demand("PENDING_CLAIM");

    const result = await home.overview({ actor, now });
    expect(result.header.unreadMessageCount).toBe(1);
    expect(result.announcement).toMatchObject({ id: announcement.id, pendingConfirm: true });
    expect(result.announcement?.id).not.toBe(hiddenAnnouncement.id);
    expect(result.teamOverview).toMatchObject({ roleLabels: ["团长"] });
    expect(result.presence).toMatchObject({ total: 7, currentCount: 1, alumniCount: 6, remainingCount: 2 });
    expect(result.presence.people).toHaveLength(5);
    expect(result.trips).toHaveLength(3);
    expect(new Set(result.trips.map(({ id }) => id)).size).toBe(3);
    expect(result.trips[0]).toMatchObject({ id: trip.id, participantNames: expect.arrayContaining([expect.stringContaining("团长"), expect.stringContaining("往届")]) });
    expect(result.todos).toHaveLength(3);
    expect(result.todos[0]).toMatchObject({ type: "HELP_PROCESS", priority: "HIGH" });
    expect(result.todos.some(({ actionUrl }) => actionUrl === `/help/${completedHelp.id}`)).toBe(false);
    expect(result.latestDemands.items).toHaveLength(3);
    expect(result.latestDemands.items[0]).toMatchObject({ id: pending.id, recommended: true, attentionLabel: "为你推荐" });
    expect(result.latestDemands.items.every(({ status }) => status === "PENDING_CLAIM")).toBe(true);
    expect(result.latestDemands.items.some(({ id }) => id === staleDemand.id)).toBe(false);

    const ministerActor: PermissionActor = { ...actor, effectiveRoles: ["MINISTER"], capabilities: resolveCapabilities(["MINISTER"], new Set()), currentBatchMember: false, currentBatchId: undefined };
    expect(await home.teamOverview({ actor: ministerActor, now })).toMatchObject({ roleLabels: ["部长"], stale: team.stale });
    const memberActor: PermissionActor = { ...actor, effectiveRoles: ["MEMBER_CURRENT"], capabilities: resolveCapabilities(["MEMBER_CURRENT"], new Set()) };
    expect((await home.overview({ actor: memberActor, now })).teamOverview).toBeNull();
    const adminActor: PermissionActor = { ...actor, effectiveRoles: ["ADMIN"], capabilities: resolveCapabilities(["ADMIN"], new Set()), hasGlobalOperational: true };
    expect((await home.overview({ actor: adminActor, now })).teamOverview).toBeNull();
  });

  it("hides an OPEN OUTCOME_FILL Todo once its active round is no longer fillable", async () => {
    const staff = await prisma.person.create({ data: { name: `A-M1-008 成效属地 ${randomUUID()}` } });
    const account = await prisma.account.create({ data: {
      personId: staff.id,
      phone: `198${Date.now().toString().slice(-8)}`,
      passwordHash: "database-test-only",
      status: "NORMAL",
      confidentialityConfirmedAt: now,
    } });
    const townshipActor: PermissionActor = {
      personId: staff.id,
      accountId: account.id,
      accountStatus: "NORMAL",
      permissionVersion: BigInt(1),
      effectiveRoles: ["TOWNSHIP_STAFF"],
      capabilities: resolveCapabilities(["TOWNSHIP_STAFF"], new Set()),
      specialPermissions: new Set(),
      selfPersonId: staff.id,
      townshipAreaIds: [areaId],
      departmentAreaIds: [],
      hasGlobalPublished: true,
      hasGlobalOperational: false,
      hasSystem: false,
      currentBatchMember: false,
      configurationIssues: [],
    };
    const completedDemand = await prisma.demand.create({ data: {
      businessNo: businessNo(),
      enterpriseId,
      responsibleAreaId: areaId,
      selectedContactId: contactId,
      title: `A-M1-008 成效待办 ${randomUUID()}`,
      originalDescription: "验证 Worker stale 前的首页只读防线。",
      demandType: "TECHNICAL",
      urgency: "NORMAL",
      status: "COMPLETED",
      creationBatchId: batchId,
      currentFollowBatchId: batchId,
      firstPublishedAt: new Date("2099-08-01T00:00:00.000Z"),
      completedAt: new Date("2099-08-20T00:00:00.000Z"),
      completionBatchId: batchId,
      createdByPersonId: creatorId,
    } });
    const plan = await prisma.demandOutcomePlan.create({ data: {
      demandId: completedDemand.id,
      trackingMode: "TRACKING",
      status: "PENDING",
      firstTrackingDate: new Date("2099-08-27T00:00:00.000Z"),
      nextTrackingDate: new Date("2099-08-27T00:00:00.000Z"),
      dueVersion: 1,
      decidedByPersonId: creatorId,
    } });
    const todo = await prisma.todo.create({ data: {
      personId: staff.id,
      todoType: "OUTCOME_FILL",
      module: "DEMAND",
      aggregateType: "DEMAND",
      aggregateId: completedDemand.id,
      actionUrl: `/demands/${completedDemand.id}`,
      dedupeKey: `home-outcome-fill-${randomUUID()}`,
    } });

    expect((await home.overview({ actor: townshipActor, now })).todos).toEqual([
      expect.objectContaining({ id: todo.id, type: "OUTCOME_FILL" }),
    ]);

    const round = await prisma.demandOutcomeRound.create({ data: {
      demandId: completedDemand.id,
      outcomePlanId: plan.id,
      roundNo: 1,
      trackingDate: new Date("2099-08-27T00:00:00.000Z"),
      trackingBatchId: batchId,
      nextTrackingDate: new Date("2099-09-27T00:00:00.000Z"),
      endTracking: false,
      reviewStatus: "PENDING_REVIEW",
      createdByPersonId: staff.id,
      submittedByPersonId: staff.id,
      submittedAt: now,
      activeKey: 1,
    } });
    expect((await home.overview({ actor: townshipActor, now })).todos).toEqual([]);
    expect(await prisma.todo.findUniqueOrThrow({ where: { id: todo.id } })).toMatchObject({ status: "OPEN", staleAt: null });

    await prisma.demandOutcomeRound.update({ where: { id: round.id }, data: {
      reviewStatus: "RETURNED",
      reviewedByPersonId: creatorId,
      reviewedAt: now,
      returnReason: "需补充核验材料",
    } });
    expect((await home.overview({ actor: townshipActor, now })).todos).toEqual([]);
    expect(await prisma.todo.findUniqueOrThrow({ where: { id: todo.id } })).toMatchObject({ status: "OPEN", staleAt: null });
  });
});
