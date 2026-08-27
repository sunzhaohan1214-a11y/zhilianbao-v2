import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { AIService, FakeDemandMatchProvider } from "@/modules/ai";
import { DemandRecommendationService, FormalDemandService } from "@/modules/demand";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

const prisma = getPrismaClient();
const service = new DemandRecommendationService();
const formalService = new FormalDemandService();
const previousCurrentBatchIds: string[] = [];
let batchId: string;
let oldBatchId: string;
let areaId: string;
let enterpriseId: string;
let contactId: string;
let creatorId: string;
let phoneSequence = 17100000000;

function permissionActor(personId: string, accountId: string, roles: RoleCode[], override: Partial<PermissionActor> = {}): PermissionActor {
  return {
    personId,
    accountId,
    accountStatus: "NORMAL",
    permissionVersion: BigInt(1),
    effectiveRoles: roles,
    capabilities: resolveCapabilities(roles, new Set()),
    specialPermissions: new Set(),
    selfPersonId: personId,
    townshipAreaIds: [],
    departmentAreaIds: [],
    hasGlobalPublished: true,
    hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"),
    hasSystem: roles.includes("SUPER_ADMIN"),
    currentBatchMember: roles.includes("MEMBER_CURRENT"),
    currentBatchId: roles.includes("MEMBER_CURRENT") ? batchId : undefined,
    configurationIssues: [],
    ...override,
  };
}

async function accountPerson(roles: RoleCode[], options: { current?: boolean; disabled?: boolean; profile?: boolean; oldMembership?: boolean } = {}) {
  const person = await prisma.person.create({ data: { name: `M1-005-${roles.join("+") || "person"}-${randomUUID()}` } });
  const account = await prisma.account.create({ data: {
    personId: person.id,
    phone: String(phoneSequence++),
    passwordHash: "database-test-only",
    status: options.disabled ? "DISABLED" : "NORMAL",
    forcePasswordChange: false,
    confidentialityConfirmedAt: new Date(),
  } });
  if (roles.length) await prisma.roleAssignment.createMany({ data: roles.map((roleCode) => ({ personId: person.id, roleCode, effectiveAt: new Date("2026-01-01") })) });
  if (options.current) await prisma.batchMembership.create({ data: { personId: person.id, batchId, startDate: new Date("2026-01-01"), endDate: new Date("2027-12-31"), status: "ACTIVE" } });
  if (options.oldMembership) await prisma.batchMembership.create({ data: { personId: person.id, batchId: oldBatchId, startDate: new Date("2024-01-01"), endDate: new Date("2025-01-01"), status: "COMPLETED" } });
  if (options.profile) await prisma.memberCapabilityProfile.create({ data: {
    personId: person.id,
    updatedByPersonId: person.id,
    professionalDirection: "智能制造工业自动化",
    coordinatableResources: "工业软件与机器人专家资源",
    personalIntroduction: "熟悉智能制造产线技术升级",
    preferredDemandTypes: { create: { demandType: "TECHNICAL" } },
  } });
  return { person, account, actor: permissionActor(person.id, account.id, roles) };
}

async function historicalPerson() {
  const person = await prisma.person.create({ data: { name: `M1-005-历史往届-${randomUUID()}` } });
  await prisma.batchMembership.create({ data: { personId: person.id, batchId: oldBatchId, startDate: new Date("2024-01-01"), endDate: new Date("2025-01-01"), status: "COMPLETED" } });
  await prisma.memberCapabilityProfile.create({ data: {
    personId: person.id,
    updatedByPersonId: person.id,
    professionalDirection: "智能制造工业自动化",
    preferredDemandTypes: { create: { demandType: "TECHNICAL" } },
  } });
  return person;
}

async function publishedDemand(firstPublishedAt = new Date()) {
  return prisma.demand.create({ data: {
    businessNo: `XQ2026${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    enterpriseId,
    responsibleAreaId: areaId,
    selectedContactId: contactId,
    title: `智能制造产线技术升级 ${randomUUID()}`,
    originalDescription: "寻找熟悉工业自动化、工业软件与机器人的人才协助技术升级。",
    demandType: "TECHNICAL",
    urgency: "NORMAL",
    status: "PENDING_CLAIM",
    creationBatchId: batchId,
    currentFollowBatchId: batchId,
    firstPublishedAt,
    createdByPersonId: creatorId,
  } });
}

function providerFor(personIds: string[]) {
  return new FakeDemandMatchProvider((request) => ({
    recommendations: personIds.filter((id) => request.input.candidates.some(({ candidateId }) => candidateId === id)).slice(0, 3).map((candidateId) => ({
      candidateId,
      reason: "专业方向与需求一致，且有真实画像依据。",
      evidenceKeys: ["PREFERRED_DEMAND_TYPE"],
    })),
  }));
}

beforeAll(async () => {
  previousCurrentBatchIds.push(...(await prisma.batch.findMany({ where: { isCurrent: true }, select: { id: true } })).map(({ id }) => id));
  await prisma.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
  const creator = await prisma.person.create({ data: { name: `M1-005 fixture creator ${randomUUID()}` } });
  creatorId = creator.id;
  const [current, old, area] = await Promise.all([
    prisma.batch.create({ data: { name: `M1-005 当前批次 ${randomUUID()}`, year: 2026, startDate: new Date("2026-01-01"), endDate: new Date("2027-12-31"), status: "ACTIVE", isCurrent: true } }),
    prisma.batch.create({ data: { name: `M1-005 往届批次 ${randomUUID()}`, year: 2024, startDate: new Date("2024-01-01"), endDate: new Date("2025-01-01"), status: "CLOSED", isCurrent: false } }),
    prisma.administrativeArea.create({ data: { name: `M1-005 区域 ${randomUUID()}`, type: "TOWNSHIP" } }),
  ]);
  batchId = current.id;
  oldBatchId = old.id;
  areaId = area.id;
  const enterprise = await prisma.enterprise.create({ data: { name: `M1-005 企业 ${randomUUID()}`, responsibleAreaId: areaId, address: "宝应县测试地址", mainProducts: "工业机器人与智能产线", createdByPersonId: creator.id } });
  enterpriseId = enterprise.id;
  const contact = await prisma.enterpriseContact.create({ data: { enterpriseId, name: "M1-005 联系人", phone: "13800001505", isPrimary: true, createdByPersonId: creator.id } });
  contactId = contact.id;
  await prisma.enterprise.update({ where: { id: enterpriseId }, data: { primaryContactId: contactId } });
});

afterAll(async () => {
  await prisma.batch.updateMany({ where: { id: batchId }, data: { isCurrent: false } });
  if (previousCurrentBatchIds.length) await prisma.batch.updateMany({ where: { id: { in: previousCurrentBatchIds } }, data: { isCurrent: true } });
  await prisma.$disconnect();
});

describe("M1-005 real MySQL recommendation", () => {
  it("filters live CURRENT candidates, switches current runs, protects visibility, excludes decline, and leaves claim authoritative", async () => {
    const [admin, eligible, disabled, ordinary, ministerOnly, leaderOnly, adminOnly, alumniOnly, expiredRole, expiredMembership] = await Promise.all([
      accountPerson(["ADMIN"]),
      accountPerson(["MEMBER_CURRENT"], { current: true, profile: true }),
      accountPerson(["MEMBER_CURRENT"], { current: true, profile: true, disabled: true }),
      accountPerson(["MEMBER_CURRENT"], { current: true }),
      accountPerson(["MINISTER"], { current: true, profile: true }),
      accountPerson(["GROUP_LEADER"], { current: true, profile: true }),
      accountPerson(["ADMIN"], { current: true, profile: true }),
      accountPerson(["MEMBER_ALUMNI_PLATFORM"], { oldMembership: true, profile: true }),
      accountPerson(["MEMBER_CURRENT"], { current: true, profile: true }),
      accountPerson(["MEMBER_CURRENT"], { current: true, profile: true }),
    ]);
    await prisma.roleAssignment.updateMany({ where: { personId: expiredRole.person.id, roleCode: "MEMBER_CURRENT" }, data: { expiredAt: new Date("2026-01-02") } });
    await prisma.batchMembership.update({ where: { personId_batchId: { personId: expiredMembership.person.id, batchId } }, data: { endDate: new Date("2026-01-02"), status: "COMPLETED" } });
    const demand = await publishedDemand();
    const first = await service.createRun({ actor: admin.actor, demandId: demand.id, body: { stage: "CURRENT" }, idempotencyKey: randomUUID() });
    const fake = providerFor([eligible.person.id, disabled.person.id]);
    await service.executeRun(first.runId, new AIService(fake));
    expect(fake.requests[0].input.candidates.map(({ candidateId }) => candidateId)).toContain(eligible.person.id);
    expect(fake.requests[0].input.candidates.map(({ candidateId }) => candidateId)).not.toContain(disabled.person.id);
    for (const excluded of [ministerOnly.person.id, leaderOnly.person.id, adminOnly.person.id, alumniOnly.person.id, expiredRole.person.id, expiredMembership.person.id]) {
      expect(fake.requests[0].input.candidates.map(({ candidateId }) => candidateId)).not.toContain(excluded);
    }
    const adminView = await service.getRecommendations({ actor: admin.actor, demandId: demand.id });
    expect(adminView.items.map(({ person }) => person.id)).toEqual([eligible.person.id]);
    expect((await service.getRecommendations({ actor: eligible.actor, demandId: demand.id })).items).toHaveLength(1);
    expect((await service.getRecommendations({ actor: ordinary.actor, demandId: demand.id })).items).toEqual([]);

    const firstItem = adminView.items[0];
    await service.respond({ actor: eligible.actor, demandId: demand.id, itemId: firstItem.id, body: { response: "DECLINE" } });
    const second = await service.createRun({ actor: admin.actor, demandId: demand.id, body: { stage: "CURRENT" }, idempotencyKey: randomUUID() });
    const secondFake = providerFor([eligible.person.id]);
    await service.executeRun(second.runId, new AIService(secondFake));
    expect(secondFake.requests[0].input.candidates.map(({ candidateId }) => candidateId)).not.toContain(eligible.person.id);
    expect(await prisma.demandRecommendationRun.count({ where: { demandId: demand.id, stage: "CURRENT", currentKey: 1 } })).toBe(1);
    expect((await prisma.demandRecommendationRun.findUniqueOrThrow({ where: { id: first.runId } })).currentKey).toBeNull();

    await expect(formalService.claim({ actor: ordinary.actor, demandId: demand.id, body: {}, idempotencyKey: randomUUID() })).resolves.toMatchObject({ status: "IN_PROGRESS" });
    expect(await prisma.demand.findUniqueOrThrow({ where: { id: demand.id } })).toMatchObject({ currentOwnerPersonId: ordinary.person.id, status: "IN_PROGRESS" });
  }, 30_000);

  it("supports zero-result alumni fallback, both alumni kinds, offline response, and formal activation without creating an owner", async () => {
    const [admin, platform, handler] = await Promise.all([
      accountPerson(["ADMIN"]),
      accountPerson(["MEMBER_ALUMNI_PLATFORM"], { oldMembership: true, profile: true }),
      accountPerson(["TOWNSHIP_STAFF"]),
    ]);
    const historical = await historicalPerson();
    const organization = await prisma.organization.create({ data: { name: `M1-005 镇区单位 ${randomUUID()}`, type: "TOWNSHIP_ORG" } });
    await prisma.organizationAreaMapping.create({ data: { organizationId: organization.id, areaId, effectiveAt: new Date("2026-01-01") } });
    await prisma.appointment.create({ data: { personId: handler.person.id, organizationId: organization.id, positionTitle: "经办人", effectiveAt: new Date("2026-01-01") } });
    handler.actor.townshipAreaIds = [areaId];
    const demand = await publishedDemand();
    await prisma.demandRecommendationRun.create({ data: { demandId: demand.id, stage: "CURRENT", status: "SUCCEEDED", triggerType: "ADMIN", rulesVersion: "test", currentKey: 1, finishedAt: new Date() } });

    const alumniRun = await service.createRun({ actor: admin.actor, demandId: demand.id, body: { stage: "ALUMNI" }, idempotencyKey: randomUUID() });
    await service.executeRun(alumniRun.runId, new AIService(providerFor([platform.person.id, historical.id])));
    const adminView = await service.getRecommendations({ actor: admin.actor, demandId: demand.id });
    expect(adminView.items.map(({ candidateKind }) => candidateKind).sort()).toEqual(["ALUMNI_HISTORICAL", "ALUMNI_PLATFORM"]);
    const platformItem = adminView.items.find(({ person }) => person.id === platform.person.id)!;
    const historicalItem = adminView.items.find(({ person }) => person.id === historical.id)!;
    await service.respond({ actor: platform.actor, demandId: demand.id, itemId: platformItem.id, body: { response: "WILLING" } });
    await service.respond({ actor: handler.actor, demandId: demand.id, itemId: historicalItem.id, body: { response: "DECLINE", responseNote: "电话联系后表示近期无法参与" } });
    await expect(service.activateAlumniHelp({ actor: admin.actor, demandId: demand.id, body: { recommendationItemId: platformItem.id, townshipHandlerPersonId: admin.person.id, reason: "验证无效经办人不可激活" } })).rejects.toMatchObject({ code: "DEMAND_TOWNSHIP_HANDLER_INVALID" });
    await service.activateAlumniHelp({ actor: admin.actor, demandId: demand.id, body: { recommendationItemId: platformItem.id, townshipHandlerPersonId: handler.person.id, reason: "往届本人已明确表达协助意愿" } });
    expect(await prisma.demand.findUniqueOrThrow({ where: { id: demand.id } })).toMatchObject({ status: "IN_PROGRESS", currentOwnerPersonId: null });
    expect(await prisma.demandOwnerHistory.count({ where: { demandId: demand.id } })).toBe(0);
    expect(await prisma.demandAlumniHelper.count({ where: { demandId: demand.id, activeKey: 1 } })).toBe(1);
    expect(await prisma.demandTownshipHandler.count({ where: { demandId: demand.id, activeKey: 1 } })).toBe(1);
    await expect(service.getCurrentDemandResponsibility(demand.id)).resolves.toEqual({ mode: "ALUMNI_TOWNSHIP", townshipHandlerPersonId: handler.person.id, alumniHelperPersonIds: [platform.person.id] });
  }, 30_000);

  it("requires explicit replacement at three and retains prior recommendation history", async () => {
    const admin = await accountPerson(["ADMIN"]);
    const township = await accountPerson(["TOWNSHIP_STAFF"]);
    const candidates = await Promise.all(Array.from({ length: 4 }, () => accountPerson(["MEMBER_CURRENT"], { current: true, profile: true })));
    const demand = await publishedDemand();
    const first = await service.createRun({ actor: admin.actor, demandId: demand.id, body: { stage: "CURRENT" }, idempotencyKey: randomUUID() });
    await service.executeRun(first.runId, new AIService(providerFor(candidates.slice(0, 3).map(({ person }) => person.id))));
    const before = await service.getRecommendations({ actor: admin.actor, demandId: demand.id });
    expect(before.items).toHaveLength(3);
    const manualBody = { stage: "CURRENT", personId: candidates[3].person.id, reason: "管理员根据线下已核实专长人工推荐", replaceItemId: before.items[0].id };
    await expect(service.manualAdd({ actor: township.actor, demandId: demand.id, body: manualBody })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    await expect(service.manualAdd({ actor: candidates[0].actor, demandId: demand.id, body: manualBody })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    await expect(service.manualAdd({ actor: admin.actor, demandId: demand.id, body: { ...manualBody, personId: admin.person.id } })).rejects.toMatchObject({ code: "DEMAND_RECOMMENDATION_STAGE_INVALID" });
    await expect(service.manualAdd({ actor: admin.actor, demandId: demand.id, body: { stage: "CURRENT", personId: candidates[3].person.id, reason: "管理员根据线下已核实专长人工推荐", replaceItemId: null } })).rejects.toMatchObject({ code: "DEMAND_RECOMMENDATION_MANUAL_REPLACE_REQUIRED" });
    const result = await service.manualAdd({ actor: admin.actor, demandId: demand.id, body: manualBody });
    expect(result.itemCount).toBe(3);
    expect(await prisma.demandRecommendationRun.count({ where: { demandId: demand.id } })).toBe(2);
    expect(await prisma.demandRecommendationItem.count({ where: { runId: first.runId } })).toBe(3);
    expect(await prisma.demandRecommendationRun.count({ where: { demandId: demand.id, stage: "CURRENT", currentKey: 1 } })).toBe(1);
  }, 30_000);

  it("serializes two successful runs and the claim-versus-alumni-activation race", async () => {
    const [adminA, adminB, current, alumni, handler] = await Promise.all([
      accountPerson(["ADMIN"]),
      accountPerson(["ADMIN"]),
      accountPerson(["MEMBER_CURRENT"], { current: true, profile: true }),
      accountPerson(["MEMBER_ALUMNI_PLATFORM"], { oldMembership: true, profile: true }),
      accountPerson(["TOWNSHIP_STAFF"]),
    ]);
    const concurrentDemand = await publishedDemand();
    const [runA, runB] = await Promise.all([
      service.createRun({ actor: adminA.actor, demandId: concurrentDemand.id, body: { stage: "CURRENT" }, idempotencyKey: randomUUID() }),
      service.createRun({ actor: adminB.actor, demandId: concurrentDemand.id, body: { stage: "CURRENT" }, idempotencyKey: randomUUID() }),
    ]);
    await Promise.all([
      service.executeRun(runA.runId, new AIService(providerFor([current.person.id]))),
      service.executeRun(runB.runId, new AIService(providerFor([current.person.id]))),
    ]);
    expect(await prisma.demandRecommendationRun.count({ where: { demandId: concurrentDemand.id, stage: "CURRENT", currentKey: 1 } })).toBe(1);
    expect(await prisma.demandRecommendationRun.count({ where: { id: { in: [runA.runId, runB.runId] }, status: "SUCCEEDED" } })).toBe(2);

    const organization = await prisma.organization.create({ data: { name: `M1-005 竞态镇区单位 ${randomUUID()}`, type: "TOWNSHIP_ORG" } });
    await prisma.organizationAreaMapping.create({ data: { organizationId: organization.id, areaId, effectiveAt: new Date("2026-01-01") } });
    await prisma.appointment.create({ data: { personId: handler.person.id, organizationId: organization.id, positionTitle: "竞态经办人", effectiveAt: new Date("2026-01-01") } });
    const racedDemand = await publishedDemand(new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000));
    await prisma.demandRecommendationRun.create({ data: { demandId: racedDemand.id, stage: "CURRENT", status: "SUCCEEDED", triggerType: "ADMIN", rulesVersion: "test", currentKey: 1, finishedAt: new Date() } });
    const alumniRun = await service.createRun({ actor: adminA.actor, demandId: racedDemand.id, body: { stage: "ALUMNI" }, idempotencyKey: randomUUID() });
    await service.executeRun(alumniRun.runId, new AIService(providerFor([alumni.person.id])));
    const alumniItem = (await service.getRecommendations({ actor: adminA.actor, demandId: racedDemand.id })).items[0];
    await service.respond({ actor: alumni.actor, demandId: racedDemand.id, itemId: alumniItem.id, body: { response: "WILLING" } });
    const raced = await Promise.allSettled([
      formalService.claim({ actor: current.actor, demandId: racedDemand.id, body: {}, idempotencyKey: randomUUID() }),
      service.activateAlumniHelp({ actor: adminA.actor, demandId: racedDemand.id, body: { recommendationItemId: alumniItem.id, townshipHandlerPersonId: handler.person.id, reason: "验证认领与往届激活互斥" } }),
    ]);
    expect(raced.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const state = await prisma.demand.findUniqueOrThrow({ where: { id: racedDemand.id } });
    const ownerCount = await prisma.demandOwnerHistory.count({ where: { demandId: racedDemand.id, activeKey: 1 } });
    const helperCount = await prisma.demandAlumniHelper.count({ where: { demandId: racedDemand.id, activeKey: 1 } });
    const handlerCount = await prisma.demandTownshipHandler.count({ where: { demandId: racedDemand.id, activeKey: 1 } });
    expect(state.status).toBe("IN_PROGRESS");
    expect([state.currentOwnerPersonId !== null && ownerCount === 1 && helperCount === 0 && handlerCount === 0, state.currentOwnerPersonId === null && ownerCount === 0 && helperCount === 1 && handlerCount === 1]).toContain(true);
  }, 30_000);

  it("fails safely with zero or multiple current batches and keeps the prior current result visible", async () => {
    const [admin, current] = await Promise.all([
      accountPerson(["ADMIN"]),
      accountPerson(["MEMBER_CURRENT"], { current: true, profile: true }),
    ]);
    const demand = await publishedDemand();
    const baseline = await service.createRun({ actor: admin.actor, demandId: demand.id, body: { stage: "CURRENT" }, idempotencyKey: randomUUID() });
    await service.executeRun(baseline.runId);
    expect(await prisma.demandRecommendationRun.findUniqueOrThrow({ where: { id: baseline.runId } })).toMatchObject({ status: "FALLBACK_SUCCEEDED", errorCategory: "AI_PROVIDER_UNAVAILABLE", currentKey: 1 });
    expect(await prisma.demandRecommendationItem.count({ where: { runId: baseline.runId, source: "RULE_FALLBACK" } })).toBeGreaterThan(0);

    await prisma.batch.update({ where: { id: batchId }, data: { isCurrent: false } });
    try {
      const noCurrent = await service.createRun({ actor: admin.actor, demandId: demand.id, body: { stage: "CURRENT" }, idempotencyKey: randomUUID() });
      await expect(service.executeRun(noCurrent.runId, new AIService(providerFor([current.person.id])))).rejects.toThrow();
      expect(await prisma.demandRecommendationRun.findUniqueOrThrow({ where: { id: noCurrent.runId } })).toMatchObject({ status: "FAILED", currentKey: null, errorCategory: "CURRENT_ACTIVE_BATCH_COUNT_INVALID" });
      expect(await prisma.demandRecommendationRun.findUniqueOrThrow({ where: { id: baseline.runId } })).toMatchObject({ currentKey: 1 });
    } finally {
      await prisma.batch.update({ where: { id: batchId }, data: { isCurrent: true } });
    }

    const duplicate = await prisma.batch.create({ data: { name: `M1-005 重复当前批次 ${randomUUID()}`, year: 2028, startDate: new Date("2028-01-01"), status: "ACTIVE", isCurrent: true } });
    try {
      const multiCurrent = await service.createRun({ actor: admin.actor, demandId: demand.id, body: { stage: "CURRENT" }, idempotencyKey: randomUUID() });
      await expect(service.executeRun(multiCurrent.runId, new AIService(providerFor([current.person.id])))).rejects.toThrow();
      expect(await prisma.demandRecommendationRun.findUniqueOrThrow({ where: { id: multiCurrent.runId } })).toMatchObject({ status: "FAILED", currentKey: null, errorCategory: "CURRENT_ACTIVE_BATCH_COUNT_INVALID" });
      expect(await prisma.demandRecommendationRun.findUniqueOrThrow({ where: { id: baseline.runId } })).toMatchObject({ currentKey: 1 });
    } finally {
      await prisma.batch.update({ where: { id: duplicate.id }, data: { isCurrent: false } });
    }
  }, 30_000);

  it("repairs illegal provider output once, persists an evidence-backed fallback, and sends no sensitive fields", async () => {
    const admin = await accountPerson(["ADMIN"]);
    await Promise.all(Array.from({ length: 5 }, () => accountPerson(["MEMBER_CURRENT"], { current: true, profile: true })));
    const demand = await publishedDemand();
    const run = await service.createRun({ actor: admin.actor, demandId: demand.id, body: { stage: "CURRENT" }, idempotencyKey: randomUUID() });
    const invalid = { recommendations: [{ candidateId: randomUUID(), reason: "伪造的候选人不应被接受。", evidenceKeys: ["INDUSTRY"] }] };
    const fake = new FakeDemandMatchProvider([invalid, invalid]);
    await service.executeRun(run.runId, new AIService(fake));
    expect(fake.requests.map(({ attempt }) => attempt)).toEqual(["INITIAL", "REPAIR"]);
    expect(fake.requests[0].input.candidates.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(fake.requests[0].input)).not.toMatch(/phone|contactPhone|help|reimbursement|手机号|报销/i);
    expect(await prisma.demandRecommendationRun.findUniqueOrThrow({ where: { id: run.runId } })).toMatchObject({ status: "FALLBACK_SUCCEEDED", errorCategory: "AI_OUTPUT_INVALID", currentKey: 1 });
    const items = await prisma.demandRecommendationItem.findMany({ where: { runId: run.runId }, orderBy: { rank: "asc" } });
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(3);
    expect(items.every((item) => item.source === "RULE_FALLBACK" && !/%|匹配度\s*\d/i.test(item.reason))).toBe(true);
    expect(items.every((item) => Array.isArray((item.evidenceSnapshotJson as { evidence?: unknown }).evidence))).toBe(true);
  }, 30_000);
});
