import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { EnterpriseService } from "@/modules/enterprise";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

const prisma = getPrismaClient(); const service = new EnterpriseService();
const personIds: string[] = []; const accountIds: string[] = []; const areaIds: string[] = [];
let admin: PermissionActor; let member: PermissionActor; let township: PermissionActor; let areaA: string; let areaB: string;

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

beforeAll(async () => {
  const [a, b] = await Promise.all([prisma.administrativeArea.create({ data: { name: `M1 A ${randomUUID()}`, type: "TOWNSHIP" } }), prisma.administrativeArea.create({ data: { name: `M1 B ${randomUUID()}`, type: "TOWNSHIP" } })]);
  areaA = a.id; areaB = b.id; areaIds.push(a.id, b.id); admin = await fixture("ADMIN"); member = await fixture("MEMBER_CURRENT"); township = await fixture("TOWNSHIP_STAFF", [areaA]);
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
});
