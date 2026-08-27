import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db/prisma";
import { BatchService, MemberService, OrganizationService } from "@/modules/member-foundation";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

const prisma = getPrismaClient();
const personIds: string[] = []; const batchIds: string[] = []; const organizationIds: string[] = [];
let actor: PermissionActor;
function phone() { return `136${Math.floor(10_000_000 + Math.random() * 89_999_999)}`; }
async function person(name: string, withAccount = false) {
  const value = await prisma.person.create({ data: { name: `B-M2-001 ${name} ${randomUUID()}`, contactPhone: withAccount ? null : "0514-88888888" } }); personIds.push(value.id);
  if (withAccount) await prisma.account.create({ data: { personId: value.id, phone: phone(), passwordHash: "database-test-hash", status: "NORMAL" } });
  return value;
}
async function batch(name: string, current = false) { const value = await prisma.batch.create({ data: { name: `${name}-${randomUUID()}`, year: 2026, startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), status: current ? "ACTIVE" : "PLANNED", isCurrent: current } }); batchIds.push(value.id); return value; }

beforeAll(async () => {
  const superPerson = await person("super", true); const account = await prisma.account.findUniqueOrThrow({ where: { personId: superPerson.id } });
  await prisma.roleAssignment.create({ data: { personId: superPerson.id, roleCode: "SUPER_ADMIN", effectiveAt: new Date(Date.now() - 60_000), reason: "B-M2-001 tests" } });
  actor = { personId: superPerson.id, accountId: account.id, accountStatus: "NORMAL", permissionVersion: account.permissionVersion, effectiveRoles: ["SUPER_ADMIN"], capabilities: resolveCapabilities(["SUPER_ADMIN"], new Set()), specialPermissions: new Set(), selfPersonId: superPerson.id, townshipAreaIds: [], departmentAreaIds: [], hasGlobalPublished: true, hasGlobalOperational: true, hasSystem: true, currentBatchMember: false, configurationIssues: [] };
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorPersonId: { in: personIds } } });
  await prisma.stateTransitionHistory.deleteMany({ where: { actorPersonId: { in: personIds } } });
  await prisma.memberCapabilityIndustry.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.memberPreferredDemandType.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.memberCapabilityProfile.deleteMany({ where: { OR: [{ personId: { in: personIds } }, { updatedByPersonId: { in: personIds } }] } });
  await prisma.groupLeaderAssignment.deleteMany({ where: { OR: [{ personId: { in: personIds } }, { grantedByPersonId: { in: personIds } }] } });
  await prisma.roleAssignment.deleteMany({ where: { OR: [{ personId: { in: personIds } }, { grantedByPersonId: { in: personIds } }] } });
  await prisma.batchMembership.deleteMany({ where: { OR: [{ personId: { in: personIds } }, { batchId: { in: batchIds } }] } });
  await prisma.appointment.deleteMany({ where: { OR: [{ personId: { in: personIds } }, { organizationId: { in: organizationIds } }] } });
  await prisma.departmentTownshipRelation.deleteMany({ where: { departmentOrganizationId: { in: organizationIds } } });
  await prisma.account.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.$disconnect();
});

describe("B-M2-001 real MySQL invariants", () => {
  it("serializes competing activations and leaves exactly one current ACTIVE batch", async () => {
    await prisma.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
    const old = await batch("old", true); const first = await batch("first"); const second = await batch("second"); const service = new BatchService(prisma);
    const outcomes = await Promise.allSettled([
      service.activate({ actor, batchId: first.id, command: { confirmation: "ACTIVATE", expectedCurrentBatchId: old.id } }),
      service.activate({ actor, batchId: second.id, command: { confirmation: "ACTIVATE", expectedCurrentBatchId: old.id } }),
    ]);
    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await prisma.batch.count({ where: { isCurrent: true, status: "ACTIVE" } })).toBe(1);
  });

  it("enforces unique and max-three memberships while extension reuses the same Person", async () => {
    const target = await person("extension"); const service = new BatchService(prisma); const batches = await Promise.all([batch("term1"), batch("term2"), batch("term3"), batch("term4")]);
    for (const item of batches.slice(0, 3)) await service.addMembership({ actor, personId: target.id, membership: { batchId: item.id, startDate: new Date("2026-01-01"), status: "ACTIVE" } });
    await expect(service.addMembership({ actor, personId: target.id, membership: { batchId: batches[0].id, startDate: new Date("2026-01-01"), status: "ACTIVE" } })).rejects.toMatchObject({ code: "MEMBERSHIP_LIMIT_EXCEEDED" });
    await expect(service.addMembership({ actor, personId: target.id, membership: { batchId: batches[3].id, startDate: new Date("2026-01-01"), status: "ACTIVE" } })).rejects.toMatchObject({ code: "MEMBERSHIP_LIMIT_EXCEEDED" });
    expect(await prisma.person.count({ where: { id: target.id } })).toBe(1); expect(await prisma.batchMembership.count({ where: { personId: target.id } })).toBe(3);
  });

  it("allows only a current member as leader and preserves revoke history with permission invalidation", async () => {
    await prisma.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } }); const current = await batch("leader-current", true); const candidate = await person("leader", true); const outsider = await person("outsider", true); const service = new BatchService(prisma);
    await expect(service.setGroupLeader({ actor, batchId: current.id, command: { action: "ASSIGN", personId: outsider.id, reason: "invalid" } })).rejects.toMatchObject({ code: "GROUP_LEADER_INVALID" });
    await prisma.batchMembership.create({ data: { personId: candidate.id, batchId: current.id, startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), status: "ACTIVE" } });
    await prisma.roleAssignment.create({ data: { personId: candidate.id, roleCode: "MEMBER_CURRENT", effectiveAt: new Date("2026-01-01"), grantedByPersonId: actor.personId, reason: "current member" } });
    const before = (await prisma.account.findUniqueOrThrow({ where: { personId: candidate.id } })).permissionVersion;
    await service.setGroupLeader({ actor, batchId: current.id, command: { action: "ASSIGN", personId: candidate.id, reason: "test assign" } });
    await service.setGroupLeader({ actor, batchId: current.id, command: { action: "REVOKE", reason: "test revoke" } });
    const after = (await prisma.account.findUniqueOrThrow({ where: { personId: candidate.id } })).permissionVersion;
    expect(after).toBeGreaterThan(before);
    expect(await prisma.groupLeaderAssignment.count({ where: { personId: candidate.id, expiredAt: { not: null } } })).toBe(1);
    expect(await prisma.stateTransitionHistory.count({ where: { entityType: "GROUP_LEADER_ASSIGNMENT", entityId: current.id } })).toBe(2);
    expect(await prisma.roleAssignment.count({ where: { personId: candidate.id, roleCode: "MINISTER" } })).toBe(0);
  });

  it("directory excludes expired appointments and member queries return one Person row", async () => {
    const organization = await prisma.organization.create({ data: { name: `directory-${randomUUID()}`, type: "DEPARTMENT" } }); organizationIds.push(organization.id);
    const visible = await person("visible"); const expired = await person("expired");
    await prisma.appointment.createMany({ data: [
      { personId: visible.id, organizationId: organization.id, positionTitle: "在岗", effectiveAt: new Date("2026-01-01") },
      { personId: expired.id, organizationId: organization.id, positionTitle: "已离岗", effectiveAt: new Date("2025-01-01"), expiredAt: new Date("2025-12-31") },
    ] });
    const directory = await new OrganizationService(prisma).detail({ actor, organizationId: organization.id });
    expect(directory.staff.map(({ personId }) => personId)).toEqual([visible.id]);
    const current = await prisma.batch.findFirstOrThrow({ where: { isCurrent: true, status: "ACTIVE" } });
    await prisma.batchMembership.create({ data: { personId: visible.id, batchId: current.id, startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), status: "ACTIVE" } });
    await prisma.roleAssignment.create({ data: { personId: visible.id, roleCode: "MEMBER_CURRENT", effectiveAt: new Date("2026-01-01"), grantedByPersonId: actor.personId, reason: "directory test" } });
    const result = await new MemberService(prisma).list({ actor, query: { kind: "current", page: 1, pageSize: 100 } });
    expect(result.items.filter(({ id }) => id === visible.id)).toHaveLength(1);
  });
});
