import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db/prisma";
import { getAttachmentRuntime, requireTestStorageAdapter } from "@/modules/attachment/runtime";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import { ReportingService } from "@/modules/reporting/reporting-service";
import { MONTHLY_REPORT_SHEETS } from "@/modules/reporting/monthly-workbook";

process.env.APP_ENV = "test";
const prisma = getPrismaClient();
const service = new ReportingService();
const ids = { people: [] as string[], accounts: [] as string[], batches: [] as string[], demands: [] as string[], attachments: [] as string[], areas: [] as string[], organizations: [] as string[], enterprises: [] as string[], trips: [] as string[], talents: [] as string[] };
let actor: PermissionActor; let areaId: string; let organizationId: string; let enterpriseId: string; let contactId: string; let batchA: string; let batchB: string; let batchC: string; let demandId: string;
let firstEnterpriseName: string; let secondEnterpriseName: string;

async function createDemand(input: { businessNo: string; title: string; publishedAt: Date; ownerAt: Date; lastProgressAt?: Date }) {
  const demand = await prisma.demand.create({ data: { businessNo: input.businessNo, enterpriseId, responsibleAreaId: areaId, selectedContactId: contactId, title: input.title, originalDescription: "结构化月报历史时点测试",
    demandType: "TECHNICAL", urgency: "NORMAL", status: "COMPLETED", creationBatchId: batchA, currentFollowBatchId: batchB, isCrossBatch: true, firstPublishedAt: input.publishedAt,
    completedAt: new Date("2026-07-10T10:00:00+08:00"), completionBatchId: batchC, createdByPersonId: actor.personId } });
  ids.demands.push(demand.id);
  await prisma.demandOwnerHistory.create({ data: { demandId: demand.id, personId: actor.personId, batchId: batchB, effectiveAt: input.ownerAt, expiredAt: new Date("2026-07-10T10:00:00+08:00"), changeType: "CROSS_BATCH_TRANSFER", createdByPersonId: actor.personId, activeKey: null } });
  if (input.lastProgressAt) await prisma.demandProgress.create({ data: { demandId: demand.id, currentProgress: "历史有效进展", nextStep: "继续跟踪", createdByPersonId: actor.personId, sourceType: "ADMIN", createdAt: input.lastProgressAt } });
  await prisma.stateTransitionHistory.createMany({ data: [
    { entityType: "DEMAND", entityId: demand.id, toState: "PENDING_CLAIM", actionCode: "DEMAND_PUBLISHED", actorPersonId: actor.personId, createdAt: input.publishedAt },
    { entityType: "DEMAND", entityId: demand.id, fromState: "PENDING_CLAIM", toState: "IN_PROGRESS", actionCode: "DEMAND_CLAIMED", actorPersonId: actor.personId, createdAt: input.ownerAt },
    { entityType: "DEMAND", entityId: demand.id, fromState: "IN_PROGRESS", toState: "PENDING_CLOSE_REVIEW", actionCode: "DEMAND_CLOSE_SUBMITTED", actorPersonId: actor.personId, createdAt: new Date("2026-07-08T10:00:00+08:00") },
    { entityType: "DEMAND", entityId: demand.id, fromState: "PENDING_CLOSE_REVIEW", toState: "COMPLETED", actionCode: "DEMAND_COMPLETED", actorPersonId: actor.personId, createdAt: new Date("2026-07-10T10:00:00+08:00") },
  ] });
  const close = await prisma.demandCloseRequest.create({ data: { demandId: demand.id, submissionNo: 1, solution: "已完成", connectedResources: "测试资源", submittedByPersonId: actor.personId, responsibilityMode: "CURRENT_OWNER", submittedAt: new Date("2026-07-08T10:00:00+08:00"), endedAt: new Date("2026-07-10T10:00:00+08:00"), activeKey: null } });
  await prisma.demandCloseReview.create({ data: { closeRequestId: close.id, demandId: demand.id, decision: "APPROVE", townshipVerificationResult: "属地已核实", reviewedByPersonId: actor.personId, reviewedAt: new Date("2026-07-10T10:00:00+08:00") } });
  return demand;
}

beforeAll(async () => {
  const [area, organization, a, b, c, person] = await Promise.all([
    prisma.administrativeArea.create({ data: { name: `M3-004区域-${randomUUID()}`, type: "TOWNSHIP" } }),
    prisma.organization.create({ data: { name: `M3-004组织-${randomUUID()}`, type: "TOWNSHIP_ORG", status: "ACTIVE" } }),
    prisma.batch.create({ data: { name: `M3-004创建批次A-${randomUUID()}`, year: 2026, startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), status: "CLOSED" } }),
    prisma.batch.create({ data: { name: `M3-004责任批次B-${randomUUID()}`, year: 2026, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "ACTIVE" } }),
    prisma.batch.create({ data: { name: `M3-004办结批次C-${randomUUID()}`, year: 2026, startDate: new Date("2026-07-01"), endDate: new Date("2027-06-30"), status: "ACTIVE" } }),
    prisma.person.create({ data: { name: `M3-004管理员-${randomUUID()}` } }),
  ]);
  areaId = area.id; organizationId = organization.id; batchA = a.id; batchB = b.id; batchC = c.id; ids.batches.push(a.id, b.id, c.id); ids.people.push(person.id); ids.areas.push(area.id); ids.organizations.push(organization.id);
  await prisma.organizationAreaMapping.create({ data: { organizationId, areaId, effectiveAt: new Date("2025-01-01") } });
  const account = await prisma.account.create({ data: { personId: person.id, phone: `136${String(Date.now()).slice(-8)}`, passwordHash: "database-test-only", status: "NORMAL", forcePasswordChange: false, confidentialityConfirmedAt: new Date("2026-01-01") } }); ids.accounts.push(account.id);
  await prisma.roleAssignment.create({ data: { personId: person.id, roleCode: "ADMIN", effectiveAt: new Date("2025-01-01") } });
  actor = { personId: person.id, accountId: account.id, accountStatus: "NORMAL", permissionVersion: account.permissionVersion, effectiveRoles: ["ADMIN"], capabilities: resolveCapabilities(["ADMIN"], new Set()), specialPermissions: new Set(), selfPersonId: person.id,
    townshipAreaIds: [], departmentAreaIds: [], hasGlobalPublished: true, hasGlobalOperational: true, hasSystem: false, currentBatchMember: false, configurationIssues: [] };
  const enterprise = await prisma.enterprise.create({ data: { name: `M3-004企业-${randomUUID()}`, responsibleAreaId: areaId, address: "宝应县测试地址", mainProducts: "电力装备", createdByPersonId: person.id, createdAt: new Date("2026-01-01") } }); enterpriseId = enterprise.id; firstEnterpriseName = enterprise.name; ids.enterprises.push(enterprise.id);
  await prisma.enterpriseVersion.create({ data: { enterpriseId, versionNo: 1, snapshotJson: { id: enterpriseId, name: enterprise.name, responsibleAreaId: areaId, status: "NORMAL" }, changeType: "CREATE", changedByPersonId: person.id, createdAt: new Date("2026-01-01") } });
  const contact = await prisma.enterpriseContact.create({ data: { enterpriseId, name: "安全联系人", phone: "13800000000", isPrimary: true, createdByPersonId: person.id } }); contactId = contact.id; await prisma.enterprise.update({ where: { id: enterpriseId }, data: { primaryContactId: contactId } });
  const main = await createDemand({ businessNo: `M3004${randomUUID().replaceAll("-", "").slice(0, 10)}`, title: "=HYPERLINK(\"unsafe\")", publishedAt: new Date("2026-06-05T09:00:00+08:00"), ownerAt: new Date("2026-06-10T09:00:00+08:00"), lastProgressAt: new Date("2026-06-20T09:00:00+08:00") }); demandId = main.id;
  await createDemand({ businessNo: `M3004${randomUUID().replaceAll("-", "").slice(0, 10)}`, title: "历史久未更新需求", publishedAt: new Date("2026-05-01T09:00:00+08:00"), ownerAt: new Date("2026-05-01T09:01:00+08:00"), lastProgressAt: new Date("2026-05-20T09:00:00+08:00") });
  const missingStatus = await prisma.demand.create({ data: { businessNo: `M3004${randomUUID().replaceAll("-", "").slice(0, 10)}`, enterpriseId, responsibleAreaId: areaId, selectedContactId: contactId, title: "缺少历史状态需求", originalDescription: "缺少统计时点前状态历史",
    demandType: "TECHNICAL", urgency: "NORMAL", status: "PENDING_CLAIM", creationBatchId: batchA, currentFollowBatchId: batchA, firstPublishedAt: new Date("2026-05-05T09:00:00+08:00"), createdByPersonId: actor.personId } });
  const missingResponsibility = await prisma.demand.create({ data: { businessNo: `M3004${randomUUID().replaceAll("-", "").slice(0, 10)}`, enterpriseId, responsibleAreaId: areaId, selectedContactId: contactId, title: "缺少历史责任需求", originalDescription: "状态可靠但责任历史缺失",
    demandType: "TECHNICAL", urgency: "NORMAL", status: "IN_PROGRESS", creationBatchId: batchA, currentFollowBatchId: batchA, firstPublishedAt: new Date("2026-05-06T09:00:00+08:00"), createdByPersonId: actor.personId } });
  ids.demands.push(missingStatus.id, missingResponsibility.id);
  await prisma.stateTransitionHistory.createMany({ data: [
    { entityType: "DEMAND", entityId: missingResponsibility.id, toState: "PENDING_CLAIM", actionCode: "DEMAND_PUBLISHED", actorPersonId: actor.personId, createdAt: new Date("2026-05-06T09:00:00+08:00") },
    { entityType: "DEMAND", entityId: missingResponsibility.id, fromState: "PENDING_CLAIM", toState: "IN_PROGRESS", actionCode: "DEMAND_CLAIMED", actorPersonId: actor.personId, createdAt: new Date("2026-05-07T09:00:00+08:00") },
  ] });
  const plan = await prisma.demandOutcomePlan.create({ data: { demandId, trackingMode: "TRACKING", status: "IN_PROGRESS", firstTrackingDate: new Date("2026-06-01"), nextTrackingDate: new Date("2026-08-01"), dueVersion: 3, decidedByPersonId: person.id, decidedAt: new Date("2026-05-20") } });
  await prisma.demandOutcomeRound.createMany({ data: [
    { demandId, outcomePlanId: plan.id, roundNo: 1, trackingDate: new Date("2026-06-15"), trackingBatchId: batchB, contractAmountIncrement: "100.20", investmentAmountIncrement: "20.00", policyFundIncrement: "0", costReductionIncrement: "0", talentIntroducedIncrement: 1, patentIncrement: 0, qualitativeResult: "六月正式成效", endTracking: false, nextTrackingDate: new Date("2026-07-15"), reviewStatus: "APPROVED", createdByPersonId: person.id, reviewedByPersonId: person.id, reviewedAt: new Date("2026-06-16"), activeKey: null },
    { demandId, outcomePlanId: plan.id, roundNo: 2, trackingDate: new Date("2026-06-20"), trackingBatchId: batchC, contractAmountIncrement: "999.99", investmentAmountIncrement: "0", policyFundIncrement: "0", costReductionIncrement: "0", talentIntroducedIncrement: 0, patentIncrement: 0, endTracking: false, nextTrackingDate: new Date("2026-07-20"), reviewStatus: "RETURNED", createdByPersonId: person.id, reviewedByPersonId: person.id, reviewedAt: new Date("2026-06-21"), activeKey: 1 },
    { demandId, outcomePlanId: plan.id, roundNo: 3, trackingDate: new Date("2026-07-20"), trackingBatchId: batchC, contractAmountIncrement: "300.00", investmentAmountIncrement: "0", policyFundIncrement: "0", costReductionIncrement: "0", talentIntroducedIncrement: 0, patentIncrement: 1, endTracking: false, nextTrackingDate: new Date("2026-08-20"), reviewStatus: "APPROVED", createdByPersonId: person.id, reviewedByPersonId: person.id, reviewedAt: new Date("2026-07-21"), activeKey: null },
    { demandId, outcomePlanId: plan.id, roundNo: 4, trackingDate: new Date("2026-06-25"), trackingBatchId: batchB, contractAmountIncrement: "500.00", investmentAmountIncrement: "0", policyFundIncrement: "0", costReductionIncrement: "0", talentIntroducedIncrement: 0, patentIncrement: 0, endTracking: false, nextTrackingDate: new Date("2026-07-25"), reviewStatus: "APPROVED", createdByPersonId: person.id, reviewedByPersonId: person.id, reviewedAt: new Date("2026-07-02"), activeKey: null },
  ] });

  const [secondPerson, thirdPerson, secondArea] = await Promise.all([
    prisma.person.create({ data: { name: `M3-004团员甲-${randomUUID()}` } }),
    prisma.person.create({ data: { name: `M3-004团员乙-${randomUUID()}` } }),
    prisma.administrativeArea.create({ data: { name: `M3-004区域乙-${randomUUID()}`, type: "TOWNSHIP" } }),
  ]);
  ids.people.push(secondPerson.id, thirdPerson.id); ids.areas.push(secondArea.id);
  await prisma.batchMembership.createMany({ data: [
    { personId: person.id, batchId: batchB, postOrganizationId: organizationId, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "ACTIVE" },
    { personId: secondPerson.id, batchId: batchB, postOrganizationId: organizationId, startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "ACTIVE" },
  ] });
  await prisma.presenceReport.createMany({ data: [
    { personId: person.id, arrivalAt: new Date("2026-06-05T09:00:00+08:00"), expectedDepartureAt: new Date("2026-06-10T18:00:00+08:00"), sourceSystem: "V2", sourceRecordId: randomUUID(), createdAt: new Date("2026-06-01") },
    { personId: person.id, arrivalAt: new Date("2026-06-28T09:00:00+08:00"), expectedDepartureAt: new Date("2026-07-02T18:00:00+08:00"), sourceSystem: "V2", sourceRecordId: randomUUID(), createdAt: new Date("2026-06-01") },
    { personId: secondPerson.id, arrivalAt: new Date("2026-06-30T09:00:00+08:00"), expectedDepartureAt: new Date("2026-07-03T18:00:00+08:00"), sourceSystem: "V2", sourceRecordId: randomUUID(), createdAt: new Date("2026-06-01") },
    { personId: person.id, arrivalAt: new Date("2026-06-29T09:00:00+08:00"), expectedDepartureAt: new Date("2026-07-03T18:00:00+08:00"), sourceSystem: "V1", sourceRecordId: randomUUID(), createdAt: new Date("2026-06-01") },
  ] });

  const secondEnterprise = await prisma.enterprise.create({ data: { name: `M3-004企业乙-${randomUUID()}`, responsibleAreaId: secondArea.id, address: "宝应县测试地址乙", mainProducts: "智能装备", createdByPersonId: person.id, createdAt: new Date("2026-01-01") } }); secondEnterpriseName = secondEnterprise.name; ids.enterprises.push(secondEnterprise.id);
  await prisma.enterpriseVersion.createMany({ data: [{ enterpriseId: secondEnterprise.id, versionNo: 1, snapshotJson: { id: secondEnterprise.id, name: secondEnterprise.name, responsibleAreaId: secondArea.id, status: "NORMAL" }, changeType: "CREATE", changedByPersonId: person.id, createdAt: new Date("2026-01-01") }] });
  const trip = await prisma.trip.create({ data: { title: "跨月跨镇区走访", purpose: "统计口径验证", createdByPersonId: person.id } }); ids.trips.push(trip.id);
  const [nodeA, nodeB] = await Promise.all([
    prisma.tripNode.create({ data: { tripId: trip.id, sequenceNo: 1, plannedStartAt: new Date("2026-06-30T09:00:00+08:00"), enterpriseId, locationName: "企业甲", content: "走访甲" } }),
    prisma.tripNode.create({ data: { tripId: trip.id, sequenceNo: 2, plannedStartAt: new Date("2026-07-01T09:00:00+08:00"), enterpriseId: secondEnterprise.id, locationName: "企业乙", content: "走访乙" } }),
  ]);
  await prisma.tripParticipant.createMany({ data: [person.id, secondPerson.id, thirdPerson.id].map((personId, index) => ({ tripId: trip.id, personId, isCreator: index === 0, joinedAt: new Date("2026-06-01T00:00:00+08:00"), addedByPersonId: person.id })) });
  const result = await prisma.tripResult.create({ data: { tripId: trip.id, resultSummary: "跨月跨镇区完整结果", submittedByPersonId: person.id, submittedAt: new Date("2026-07-01T18:00:00+08:00") } });
  const [visitA, visitB] = await Promise.all([
    prisma.enterpriseVisit.create({ data: { tripId: trip.id, tripNodeId: nodeA.id, enterpriseId, visitedAt: new Date("2026-06-30T09:00:00+08:00"), visitSummary: "甲镇区结果", createdFromTripResultId: result.id } }),
    prisma.enterpriseVisit.create({ data: { tripId: trip.id, tripNodeId: nodeB.id, enterpriseId: secondEnterprise.id, visitedAt: new Date("2026-07-01T09:00:00+08:00"), visitSummary: "乙镇区结果", createdFromTripResultId: result.id } }),
  ]);
  await prisma.demandLead.createMany({ data: [
    { businessNo: `XL${randomUUID().replaceAll("-", "").slice(0, 12)}`, sourceType: "MEMBER_VISIT", responsibleAreaId: areaId, enterpriseId, rawTitle: "甲线索", rawContent: "甲走访线索", sourcePersonId: person.id, sourceAt: new Date("2026-06-30T10:00:00+08:00"), tripId: trip.id, visitId: visitA.id, status: "PENDING_TOWNSHIP_VERIFY", createdByPersonId: person.id },
    { businessNo: `XL${randomUUID().replaceAll("-", "").slice(0, 12)}`, sourceType: "MEMBER_VISIT", responsibleAreaId: secondArea.id, enterpriseId: secondEnterprise.id, rawTitle: "乙线索", rawContent: "乙走访线索", sourcePersonId: secondPerson.id, sourceAt: new Date("2026-07-01T10:00:00+08:00"), tripId: trip.id, visitId: visitB.id, status: "PENDING_TOWNSHIP_VERIFY", createdByPersonId: secondPerson.id },
  ] });

  const [domesticTalent, overseasTalent] = await Promise.all([
    prisma.talent.create({ data: { name: "六月国内人才", scopeType: "DOMESTIC", organizationName: "国内高校", title: "教授", professionalDirection: "先进制造", originalRecommenderPersonId: person.id, currentContactPersonId: person.id, createdByPersonId: person.id, createdAt: new Date("2026-06-03T09:00:00+08:00") } }),
    prisma.talent.create({ data: { name: "存量海外人才", scopeType: "OVERSEAS", organizationName: "海外高校", title: "教授", professionalDirection: "新材料", originalRecommenderPersonId: person.id, currentContactPersonId: person.id, createdByPersonId: person.id, createdAt: new Date("2026-05-03T09:00:00+08:00") } }),
  ]); ids.talents.push(domesticTalent.id, overseasTalent.id);
  await prisma.talentTownshipRound.createMany({ data: [
    { talentId: domesticTalent.id, areaId, roundNo: 1, status: "COMPLETED", activeKey: null, startedByPersonId: person.id, currentHandlerPersonId: person.id, startedAt: new Date("2026-06-05T09:00:00+08:00"), completedAt: new Date("2026-06-20T09:00:00+08:00"), resultSummary: "完成对接" },
    { talentId: overseasTalent.id, areaId, roundNo: 1, status: "IN_PROGRESS", activeKey: 1, startedByPersonId: person.id, currentHandlerPersonId: person.id, startedAt: new Date("2026-05-10T09:00:00+08:00") },
  ] });
});

afterAll(async () => {
  const tasks = await prisma.monthlyReportExportTask.findMany({ where: { createdByPersonId: actor.personId }, select: { id: true, outputAttachmentId: true } }); ids.attachments.push(...tasks.flatMap(({ outputAttachmentId }) => outputAttachmentId ? [outputAttachmentId] : []));
  await prisma.attachmentAccessLog.deleteMany({ where: { attachmentId: { in: ids.attachments } } }); await prisma.attachmentLink.deleteMany({ where: { entityType: "MONTHLY_REPORT_EXPORT_TASK", entityId: { in: tasks.map(({ id }) => id) } } });
  await prisma.monthlyReportExportTask.deleteMany({ where: { id: { in: tasks.map(({ id }) => id) } } }); await prisma.attachment.deleteMany({ where: { id: { in: ids.attachments } } }); await prisma.jobTask.deleteMany({ where: { jobType: "MONTHLY_REPORT_EXPORT" } });
  await prisma.demandOutcomeRound.deleteMany({ where: { demandId: { in: ids.demands } } }); await prisma.demandOutcomePlan.deleteMany({ where: { demandId: { in: ids.demands } } }); await prisma.demandCloseReview.deleteMany({ where: { demandId: { in: ids.demands } } });
  await prisma.demandCloseRequest.deleteMany({ where: { demandId: { in: ids.demands } } }); await prisma.demandProgress.deleteMany({ where: { demandId: { in: ids.demands } } }); await prisma.demandOwnerHistory.deleteMany({ where: { demandId: { in: ids.demands } } });
  await prisma.stateTransitionHistory.deleteMany({ where: { entityType: "DEMAND", entityId: { in: ids.demands } } }); await prisma.demand.deleteMany({ where: { id: { in: ids.demands } } });
  await prisma.demandLead.deleteMany({ where: { tripId: { in: ids.trips } } }); await prisma.enterpriseVisit.deleteMany({ where: { tripId: { in: ids.trips } } }); await prisma.tripResult.deleteMany({ where: { tripId: { in: ids.trips } } });
  await prisma.tripNode.deleteMany({ where: { tripId: { in: ids.trips } } }); await prisma.tripParticipant.deleteMany({ where: { tripId: { in: ids.trips } } }); await prisma.trip.deleteMany({ where: { id: { in: ids.trips } } });
  await prisma.talentTownshipRound.deleteMany({ where: { talentId: { in: ids.talents } } }); await prisma.talent.deleteMany({ where: { id: { in: ids.talents } } });
  await prisma.presenceReport.deleteMany({ where: { personId: { in: ids.people } } }); await prisma.batchMembership.deleteMany({ where: { personId: { in: ids.people }, batchId: batchB } });
  await prisma.enterpriseVersion.deleteMany({ where: { enterpriseId: { in: ids.enterprises } } }); await prisma.enterprise.update({ where: { id: enterpriseId }, data: { primaryContactId: null } }); await prisma.enterpriseContact.deleteMany({ where: { enterpriseId } }); await prisma.enterprise.deleteMany({ where: { id: { in: ids.enterprises } } });
  await prisma.organizationAreaMapping.deleteMany({ where: { organizationId } }); await prisma.organization.deleteMany({ where: { id: { in: ids.organizations } } }); await prisma.roleAssignment.deleteMany({ where: { personId: actor.personId } }); await prisma.auditLog.deleteMany({ where: { actorPersonId: actor.personId } });
  await prisma.account.deleteMany({ where: { id: { in: ids.accounts } } }); await prisma.person.deleteMany({ where: { id: { in: ids.people } } }); await prisma.batch.deleteMany({ where: { id: { in: ids.batches } } }); await prisma.administrativeArea.deleteMany({ where: { id: { in: ids.areas } } }); await prisma.$disconnect();
});

describe("C-M3-004 real MySQL historical reporting", () => {
  it("keeps June demand IN_PROGRESS even though current status is COMPLETED and applies cross-batch semantics", async () => {
    const juneB = await service.previewMonthlyReport({ actor, query: { month: "2026-06", areaId, batchId: batchB }, now: new Date("2026-08-28T12:00:00+08:00") });
    expect(juneB.overview.demand.added).toBe(0); expect(juneB.overview.demand.completed).toBe(0); expect(juneB.overview.demand.stock.IN_PROGRESS).toBe(2); expect(juneB.overview.demand.stale).toBe(1);
    const juneA = await service.previewMonthlyReport({ actor, query: { month: "2026-06", areaId, batchId: batchA }, now: new Date("2026-08-28T12:00:00+08:00") }); expect(juneA.overview.demand.added).toBe(1); expect(juneA.overview.demand.stock.IN_PROGRESS).toBe(0);
    const julyC = await service.previewMonthlyReport({ actor, query: { month: "2026-07", areaId, batchId: batchC }, now: new Date("2026-08-28T12:00:00+08:00") }); expect(julyC.overview.demand.completed).toBe(2);
  });

  it("counts only APPROVED outcome increments by trackingDate and trackingBatch", async () => {
    const juneB = await service.previewMonthlyReport({ actor, query: { month: "2026-06", areaId, batchId: batchB } }); expect(juneB.overview.outcome.contractAmount).toBe("100.20");
    const juneC = await service.previewMonthlyReport({ actor, query: { month: "2026-06", areaId, batchId: batchC } }); expect(juneC.overview.outcome.contractAmount).toBe("0.00");
  });

  it("warns and preserves published demands when historical status or responsibility is unresolved", async () => {
    const report = await service.previewMonthlyReport({ actor, query: { month: "2026-06", areaId }, now: new Date("2026-08-28T12:00:00+08:00") });
    expect(report.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "DEMAND_STATUS_ASOF_MISSING", count: 1 }),
      expect.objectContaining({ code: "DEMAND_RESPONSIBILITY_ASOF_MISSING", count: 1 }),
    ]));
    const missingStatus = report.rows.demands.find((row) => row.title === "缺少历史状态需求");
    expect(missingStatus).toMatchObject({ statusAt: "UNRESOLVED", added: "否", completed: "否" });
    expect(report.overview.demand.stock.PENDING_CLAIM).toBe(0);
    const missingResponsibility = report.rows.demands.find((row) => row.title === "缺少历史责任需求");
    expect(missingResponsibility).toMatchObject({ statusAt: "IN_PROGRESS", responsibility: "UNRESOLVED", stale: "否" });
  });

  it("counts a cross-month Trip once while keeping Visit and DemandLead month slices independent", async () => {
    const county = await service.previewMonthlyReport({ actor, query: { month: "2026-06", batchId: batchB }, now: new Date("2026-08-28T12:00:00+08:00") });
    expect(county.overview.resources.arrivalVisits).toBe(3); expect(county.overview.resources.presentPeople).toBe(2);
    expect(county.overview.trips).toEqual({ tripCount: 1, participantVisits: 3, distinctParticipants: 3, distinctEnterprises: 1, leadCount: 1 });
    expect(county.overview.talent).toEqual({ added: 1, completedRounds: 1, inProgressRounds: 1, domestic: 1, overseas: 0 });
    const area = await service.previewMonthlyReport({ actor, query: { month: "2026-06", areaId, batchId: batchB }, now: new Date("2026-08-28T12:00:00+08:00") });
    expect(area.overview.trips.distinctEnterprises).toBe(1); expect(area.overview.trips.leadCount).toBe(1);
    expect(area.rows.trips[0]?.enterprises).toMatch(/^M3-004企业-/); expect(area.rows.trips[0]?.enterprises).not.toContain("、"); expect(area.rows.trips[0]?.result).toBe("甲镇区结果");
    const july = await service.previewMonthlyReport({ actor, query: { month: "2026-07", batchId: batchC }, now: new Date("2026-08-28T12:00:00+08:00") });
    expect(july.overview.trips).toEqual({ tripCount: 0, participantVisits: 0, distinctParticipants: 0, distinctEnterprises: 1, leadCount: 1 });
    expect(july.rows.trips[0]).toMatchObject({ date: "2026-06-30", enterprises: secondEnterpriseName, result: "乙镇区结果", leadCount: 1 });
    expect(july.rows.trips[0]?.enterprises).not.toContain(firstEnterpriseName);
  });

  it("reopens one private idempotent July output with five safe sheets and numeric money cells", async () => {
    const created = await service.createMonthlyExport({ actor, body: { month: "2026-07", batchId: batchC }, idempotencyKey: "m3-004-database-worker" });
    const replay = await service.createMonthlyExport({ actor, body: { month: "2026-07", batchId: batchC }, idempotencyKey: "m3-004-database-worker" }); expect(replay.id).toBe(created.id);
    await Promise.all([service.processExport(created.id), service.processExport(created.id)]); await service.processExport(created.id);
    const task = await prisma.monthlyReportExportTask.findUniqueOrThrow({ where: { id: created.id } }); expect(task.status).toBe("SUCCEEDED"); expect(task.outputAttachmentId).toBeTruthy();
    expect(await prisma.attachmentLink.count({ where: { entityType: "MONTHLY_REPORT_EXPORT_TASK", entityId: task.id, relationType: "OUTPUT" } })).toBe(1);
    const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id: task.outputAttachmentId! } }); const bytes = requireTestStorageAdapter().getObjectForTest(attachment.objectKey!); expect(bytes).toBeTruthy();
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes! as never); expect(workbook.worksheets.map(({ name }) => name)).toEqual(MONTHLY_REPORT_SHEETS); expect(workbook.worksheets).toHaveLength(5);
    expect(workbook.getWorksheet("需求进展")?.getColumn(2).values).toContain("'=HYPERLINK(\"unsafe\")");
    const overview = workbook.getWorksheet("月度概览")!;
    for (const metric of ["合同金额新增", "投资额新增", "政策资金新增", "降本新增"]) {
      const row = overview.getColumn(2).values.findIndex((value) => value === metric);
      expect(typeof overview.getCell(row, 3).value).toBe("number"); expect(overview.getCell(row, 3).numFmt).toBe("#,##0.00");
    }
    const outcome = workbook.getWorksheet("成效跟踪")!;
    for (const column of ["H", "I", "J", "K"]) { expect(typeof outcome.getCell(`${column}2`).value).toBe("number"); expect(outcome.getCell(`${column}2`).numFmt).toBe("#,##0.00"); }
    const tripEnterprises = workbook.getWorksheet("走访与行程")?.getCell("D2").value;
    expect(tripEnterprises).toBe(secondEnterpriseName); expect(String(tripEnterprises)).not.toContain(firstEnterpriseName);
    const allText = workbook.worksheets.flatMap((sheet) => sheet.getSheetValues()).flat(3).map(String).join("|"); expect(allText).not.toContain("报销"); expect(allText).not.toContain("办事求助");
    const access = await getAttachmentRuntime().service.access({ actor, attachmentId: task.outputAttachmentId!, action: "DOWNLOAD", context: { ip: "127.0.0.1", userAgent: "vitest", deviceId: "db", deviceName: "database", requestId: randomUUID() } }); expect(access.url).toContain("memory.invalid");
  });
});
