import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AdministrativeAreaType, RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { EnterpriseRepository, EnterpriseService, type EnterpriseTransaction } from "@/modules/enterprise";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

const prisma = getPrismaClient(); const service = new EnterpriseService();
const personIds: string[] = []; const accountIds: string[] = []; const areaIds: string[] = [];
let admin: PermissionActor; let member: PermissionActor; let township: PermissionActor; let minister: PermissionActor; let department: PermissionActor;
let areaA: string; let areaB: string; let parkArea: string; let highTechArea: string; let developmentArea: string;
let countyArea: string; let otherArea: string; let inactiveParkArea: string;

async function fixture(role: RoleCode, townships: string[] = []) {
  const person = await prisma.person.create({ data: { name: `M1-001 ${role} ${randomUUID()}` } }); personIds.push(person.id);
  const account = await prisma.account.create({ data: { personId: person.id, phone: `139${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, passwordHash: "database-test-only", status: "NORMAL" } }); accountIds.push(account.id);
  const roles = [role]; const capabilities = resolveCapabilities(roles, new Set());
  return { personId: person.id, accountId: account.id, accountStatus: "NORMAL" as const, effectiveRoles: roles,
    capabilities, specialPermissions: new Set<string>(), selfPersonId: person.id, townshipAreaIds: townships, departmentAreaIds: [],
    hasGlobalPublished: true, hasGlobalOperational: role === "ADMIN" || role === "SUPER_ADMIN", hasSystem: role === "SUPER_ADMIN",
    currentBatchMember: role === "MEMBER_CURRENT", configurationIssues: [], permissionVersion: BigInt(1) } satisfies PermissionActor;
}
function core(areaId: string, suffix = randomUUID()) { return { name: `M1企业-${suffix}`, responsibleAreaId: areaId, address: "江苏省宝应县测试路1号", creditCode: `91321023${suffix.replaceAll("-", "").slice(0, 10).toUpperCase()}`, mainProducts: "高端装备与技术服务", tagIds: [] }; }

async function areaFixture(type: AdministrativeAreaType, status: "ACTIVE" | "INACTIVE" = "ACTIVE") {
  const area = await prisma.administrativeArea.create({ data: { name: `M1 ${type} ${randomUUID()}`, type, status } });
  areaIds.push(area.id);
  return area.id;
}

class MergeGateRepository extends EnterpriseRepository {
  private resolveMergeLocked!: () => void;
  private resolveUpdateLockAttempted!: () => void;
  private resolveMergeRelease!: () => void;
  readonly mergeLocked = new Promise<void>((resolve) => { this.resolveMergeLocked = resolve; });
  readonly updateLockAttempted = new Promise<void>((resolve) => { this.resolveUpdateLockAttempted = resolve; });
  private readonly mergeRelease = new Promise<void>((resolve) => { this.resolveMergeRelease = resolve; });

  override async lockEnterprises(tx: EnterpriseTransaction, enterpriseIds: readonly string[]): Promise<void> {
    for (const id of [...new Set(enterpriseIds)].sort()) {
      await EnterpriseRepository.prototype.lockEnterprise.call(this, tx, id);
    }
    this.resolveMergeLocked();
    await this.mergeRelease;
  }

  override async lockEnterprise(tx: EnterpriseTransaction, enterpriseId: string): Promise<void> {
    this.resolveUpdateLockAttempted();
    await super.lockEnterprise(tx, enterpriseId);
  }

  releaseMerge() { this.resolveMergeRelease(); }
}

beforeAll(async () => {
  [areaA, areaB, parkArea, highTechArea, developmentArea, countyArea, otherArea, inactiveParkArea] = await Promise.all([
    areaFixture("TOWNSHIP"), areaFixture("TOWNSHIP"), areaFixture("PARK"), areaFixture("HIGH_TECH_ZONE"),
    areaFixture("DEVELOPMENT_ZONE"), areaFixture("COUNTY"), areaFixture("OTHER_AREA"), areaFixture("PARK", "INACTIVE"),
  ]);
  [admin, member, township, minister, department] = await Promise.all([
    fixture("ADMIN"), fixture("MEMBER_CURRENT"), fixture("TOWNSHIP_STAFF", [areaA]), fixture("MINISTER"), fixture("DEPARTMENT_STAFF"),
  ]);
});
afterAll(async () => {
  const enterpriseWhere = { createdByPersonId: { in: personIds } };
  await prisma.enterprise.updateMany({ where: enterpriseWhere, data: { status: "NORMAL", mergedIntoId: null, primaryContactId: null } });
  await prisma.auditLog.deleteMany({ where: { actorPersonId: { in: personIds } } });
  await prisma.stateTransitionHistory.deleteMany({ where: { actorPersonId: { in: personIds } } });
  await prisma.enterpriseChangeRequest.deleteMany({ where: { submitterPersonId: { in: personIds } } });
  await prisma.enterpriseVersion.deleteMany({ where: { enterprise: enterpriseWhere } });
  await prisma.enterpriseTagRelation.deleteMany({ where: { enterprise: enterpriseWhere } });
  await prisma.enterpriseContact.deleteMany({ where: { enterprise: enterpriseWhere } });
  await prisma.enterprise.deleteMany({ where: enterpriseWhere });
  await prisma.account.deleteMany({ where: { id: { in: accountIds } } }); await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.administrativeArea.deleteMany({ where: { id: { in: areaIds } } }); await prisma.$disconnect();
});

describe("M1-001 real MySQL enterprise lifecycle", () => {
  it("accepts only active township and park-like responsible areas", async () => {
    for (const areaId of [areaA, parkArea, highTechArea, developmentArea]) {
      await expect(service.createFormal({ actor: admin, enterprise: core(areaId) })).resolves.toMatchObject({ responsibleAreaId: areaId });
    }
    for (const areaId of [countyArea, otherArea, inactiveParkArea]) {
      await expect(service.createFormal({ actor: admin, enterprise: core(areaId) })).rejects.toMatchObject({ code: "ENTERPRISE_AREA_INVALID" });
    }
    const enterprise = await service.createFormal({ actor: admin, enterprise: core(areaA) });
    await expect(service.formalCorrection({ actor: admin, enterpriseId: enterprise.id, changes: { responsibleAreaId: countyArea }, reason: "非法归属纠正" }))
      .rejects.toMatchObject({ code: "ENTERPRISE_AREA_INVALID" });
    const countyScopedTownship = { ...township, townshipAreaIds: [areaA, countyArea] };
    await expect(service.createChangeRequest({ actor: countyScopedTownship, request: {
      requestType: "CREATE", proposedAreaId: countyArea, payload: { enterprise: core(countyArea) },
    } })).rejects.toMatchObject({ code: "ENTERPRISE_AREA_INVALID" });
  });

  it("separates county-wide read filters from scoped create options", async () => {
    const validAreaIds = [areaA, areaB, parkArea, highTechArea, developmentArea];
    for (const actor of [member, minister, department]) {
      const ids = (await service.formOptions({ actor, purpose: "READ_FILTER" })).areas.map(({ id }) => id);
      expect(ids).toEqual(expect.arrayContaining(validAreaIds));
      expect(ids).not.toContain(countyArea);
      expect(ids).not.toContain(otherArea);
      expect(ids).not.toContain(inactiveParkArea);
    }
    expect((await service.formOptions({ actor: township, purpose: "CREATE_APPLICATION" })).areas.map(({ id }) => id)).toEqual([areaA]);
    const formalIds = (await service.formOptions({ actor: admin, purpose: "FORMAL_CREATE" })).areas.map(({ id }) => id);
    expect(formalIds).toEqual(expect.arrayContaining(validAreaIds));
    for (const invalidAreaId of [countyArea, otherArea, inactiveParkArea]) expect(formalIds).not.toContain(invalidAreaId);
    await expect(service.createChangeRequest({ actor: township, request: {
      requestType: "CREATE", proposedAreaId: areaB, payload: { enterprise: core(areaB) },
    } })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
  });

  it("creates v1, corrects with optimistic versioning, disables and restores", async () => {
    const created = await service.createFormal({ actor: admin, enterprise: core(areaA) });
    expect(await prisma.enterpriseVersion.count({ where: { enterpriseId: created.id, versionNo: 1 } })).toBe(1);
    const corrected = await service.formalCorrection({ actor: admin, enterpriseId: created.id, changes: { mainProducts: "新产品" }, reason: "正式纠正", baseVersion: 1 });
    expect(corrected.currentVersion).toBe(2);
    await expect(service.formalCorrection({ actor: admin, enterpriseId: created.id, changes: { address: "旧版本修改" }, reason: "并发冲突", baseVersion: 1 })).rejects.toMatchObject({ code: "ENTERPRISE_VERSION_CONFLICT", status: 409 });
    expect((await service.disable({ actor: admin, enterpriseId: created.id, reason: "暂时停业" })).status).toBe("DISABLED");
    expect((await service.restore({ actor: admin, enterpriseId: created.id, reason: "恢复经营" })).status).toBe("NORMAL");
    expect(await prisma.enterpriseVersion.count({ where: { enterpriseId: created.id } })).toBe(4);
  });

  it("allows only one concurrent unique credit code", async () => {
    const shared = core(areaA); const results = await Promise.allSettled([service.createFormal({ actor: admin, enterprise: { ...shared, name: `${shared.name}-1` } }), service.createFormal({ actor: admin, enterprise: { ...shared, name: `${shared.name}-2` } })]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1); expect(await prisma.enterprise.count({ where: { creditCode: shared.creditCode } })).toBe(1);
  });

  it("merges without deleting history and rejects merged targets/cycles", async () => {
    const source = await service.createFormal({ actor: admin, enterprise: core(areaA) }); const target = await service.createFormal({ actor: admin, enterprise: core(areaA) }); const third = await service.createFormal({ actor: admin, enterprise: core(areaA) });
    await service.merge({ actor: admin, enterpriseId: source.id, targetEnterpriseId: target.id, reason: "重复档案", confirmation: "CONFIRM" });
    expect(await prisma.enterprise.findUnique({ where: { id: source.id } })).toMatchObject({ status: "MERGED", mergedIntoId: target.id });
    await expect(service.merge({ actor: admin, enterpriseId: third.id, targetEnterpriseId: source.id, reason: "禁止环", confirmation: "CONFIRM" })).rejects.toMatchObject({ code: "ENTERPRISE_STATE_CONFLICT" });
    expect(await service.list({ actor: member, query: { page: 1, pageSize: 100 } })).toMatchObject({ items: expect.not.arrayContaining([expect.objectContaining({ id: source.id })]) });
    expect((await service.list({ actor: admin, query: { status: "MERGED", page: 1, pageSize: 100 } })).items.some((x) => x.id === source.id)).toBe(true);
  });
});

describe("M1-001 real MySQL requests and contacts", () => {
  it("enforces township scope, return/resubmit, atomic approval and one concurrent reviewer", async () => {
    const payload = { enterprise: core(areaA) }; const request = await service.createChangeRequest({ actor: township, request: { requestType: "CREATE", proposedAreaId: areaA, payload } });
    await expect(service.createChangeRequest({ actor: township, request: { requestType: "CREATE", proposedAreaId: areaB, payload: { enterprise: core(areaB) } } })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    await expect(service.createFormal({ actor: member, enterprise: core(areaA) })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    await service.reviewChangeRequest({ actor: admin, requestId: request.id, decision: "RETURN", reason: "补充材料" });
    await service.resubmitChangeRequest({ actor: township, requestId: request.id, body: { payload } });
    const outcomes = await Promise.allSettled([1, 2].map(() => service.reviewChangeRequest({ actor: admin, requestId: request.id, decision: "APPROVE", reason: "材料完整" })));
    expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const approved = await prisma.enterpriseChangeRequest.findUniqueOrThrow({ where: { id: request.id } }); expect(approved.status).toBe("APPROVED"); expect(approved.approvedEnterpriseId).toBeTruthy();
  });

  it("applies correction requests atomically and rejects stale bases", async () => {
    const target = await service.createFormal({ actor: admin, enterprise: core(areaA) }); const request = await service.createChangeRequest({ actor: member, request: { requestType: "CORRECTION", targetEnterpriseId: target.id, baseEnterpriseVersion: 1, payload: { changes: { address: "纠错后的地址" } } } });
    await service.reviewChangeRequest({ actor: admin, requestId: request.id, decision: "APPROVE", reason: "核验通过" });
    expect(await prisma.enterprise.findUnique({ where: { id: target.id } })).toMatchObject({ address: "纠错后的地址", currentVersion: 2 });
    await expect(service.createChangeRequest({ actor: member, request: { requestType: "CORRECTION", targetEnterpriseId: target.id, baseEnterpriseVersion: 1, payload: { changes: { address: "过期版本" } } } })).rejects.toMatchObject({ code: "ENTERPRISE_VERSION_CONFLICT" });
  });

  it("serializes primary contacts and enforces replacement and township ownership", async () => {
    const enterprise = await service.createFormal({ actor: admin, enterprise: core(areaA) }); const otherEnterprise = await service.createFormal({ actor: admin, enterprise: core(areaB) });
    const first = await service.createContact({ actor: township, enterpriseId: enterprise.id, contact: { name: "甲", phone: "13800002001", setPrimary: true } }); const second = await service.createContact({ actor: township, enterpriseId: enterprise.id, contact: { name: "乙", phone: "13800002002", setPrimary: false } }); const foreign = await service.createContact({ actor: admin, enterpriseId: otherEnterprise.id, contact: { name: "丙", phone: "13800002003", setPrimary: true } });
    await Promise.all([service.setPrimaryContact({ actor: township, contactId: first.id }), service.setPrimaryContact({ actor: township, contactId: second.id })]);
    expect(await prisma.enterpriseContact.count({ where: { enterpriseId: enterprise.id, status: "ACTIVE", isPrimary: true } })).toBe(1);
    const primary = await prisma.enterpriseContact.findFirstOrThrow({ where: { enterpriseId: enterprise.id, isPrimary: true } });
    await expect(service.disableContact({ actor: township, contactId: primary.id, reason: "离职" })).rejects.toMatchObject({ code: "ENTERPRISE_PRIMARY_CONTACT_REQUIRED" });
    await expect(service.disableContact({ actor: township, contactId: primary.id, reason: "离职", replacementContactId: foreign.id })).rejects.toMatchObject({ code: "ENTERPRISE_CONTACT_INVALID_REPLACEMENT" });
    const replacement = primary.id === first.id ? second : first; await service.disableContact({ actor: township, contactId: primary.id, reason: "离职", replacementContactId: replacement.id });
    expect(await prisma.enterpriseContact.findUnique({ where: { id: primary.id } })).toMatchObject({ status: "INACTIVE", isPrimary: false });
    await expect(service.createContact({ actor: township, enterpriseId: otherEnterprise.id, contact: { name: "越权", phone: "13800002004", setPrimary: false } })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    await expect(service.createContact({ actor: admin, enterpriseId: otherEnterprise.id, contact: { name: "管理员", phone: "13800002005", setPrimary: false } })).resolves.toMatchObject({ status: "ACTIVE" });
    const detail = await service.detail({ actor: member, enterpriseId: enterprise.id }); expect(detail?.contacts.some((x) => x.phone === replacement.phone)).toBe(true);
  });

  it("updates only active contacts of non-merged enterprises", async () => {
    const enterprise = await service.createFormal({ actor: admin, enterprise: core(areaA) });
    const active = await service.createContact({ actor: admin, enterpriseId: enterprise.id, contact: { name: "可更新", phone: "13800002101", setPrimary: false } });
    await expect(service.updateContact({ actor: admin, contactId: active.id, changes: { name: "已更新" } })).resolves.toMatchObject({ name: "已更新" });
    const inactive = await service.createContact({ actor: admin, enterpriseId: enterprise.id, contact: { name: "将停用", phone: "13800002102", setPrimary: false } });
    await service.disableContact({ actor: admin, contactId: inactive.id, reason: "离职" });
    await expect(service.updateContact({ actor: admin, contactId: inactive.id, changes: { name: "不得更新" } })).rejects.toMatchObject({ code: "ENTERPRISE_STATE_CONFLICT" });

    const mergedSource = await service.createFormal({ actor: admin, enterprise: core(areaA) });
    const mergeTarget = await service.createFormal({ actor: admin, enterprise: core(areaA) });
    const historical = await service.createContact({ actor: admin, enterpriseId: mergedSource.id, contact: { name: "历史联系人", phone: "13800002103", setPrimary: false } });
    await service.merge({ actor: admin, enterpriseId: mergedSource.id, targetEnterpriseId: mergeTarget.id, reason: "重复档案", confirmation: "CONFIRM" });
    await expect(service.updateContact({ actor: admin, contactId: historical.id, changes: { name: "不得修改历史" } })).rejects.toMatchObject({ code: "ENTERPRISE_STATE_CONFLICT" });
  });

  it("serializes updateContact behind merge and rechecks the locked enterprise state", async () => {
    const source = await service.createFormal({ actor: admin, enterprise: core(areaA) });
    const target = await service.createFormal({ actor: admin, enterprise: core(areaA) });
    const contact = await service.createContact({ actor: admin, enterpriseId: source.id, contact: { name: "并发前姓名", phone: "13800002104", setPrimary: false } });
    const repository = new MergeGateRepository();
    const gatedService = new EnterpriseService(repository);
    const merge = gatedService.merge({ actor: admin, enterpriseId: source.id, targetEnterpriseId: target.id, reason: "并发合并", confirmation: "CONFIRM" });
    await repository.mergeLocked;
    const update = gatedService.updateContact({ actor: admin, contactId: contact.id, changes: { name: "并发后姓名" } });
    await Promise.race([
      repository.updateLockAttempted,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("updateContact did not attempt the Enterprise row lock")), 2_000)),
    ]);
    repository.releaseMerge();
    const [mergeResult, updateResult] = await Promise.allSettled([merge, update]);
    expect(mergeResult.status).toBe("fulfilled");
    expect(updateResult).toMatchObject({ status: "rejected", reason: { code: "ENTERPRISE_STATE_CONFLICT" } });
    expect(await prisma.enterpriseContact.findUnique({ where: { id: contact.id } })).toMatchObject({ name: "并发前姓名" });
  });
});
