import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import { PresenceService } from "@/modules/presence";

const prisma = getPrismaClient();
const service = new PresenceService();
const personIds: string[] = [];
const accountIds: string[] = [];
let member: PermissionActor;
let alumni: PermissionActor;
let admin: PermissionActor;
let minister: PermissionActor;
let leader: PermissionActor;
let validClassificationMember: PermissionActor;
let expiredMembershipMember: PermissionActor;
let futureMembershipMember: PermissionActor;
let expiredRoleMember: PermissionActor;
let batchId: string;
const batchIds: string[] = [];

async function fixture(role: RoleCode, roleExpiredAt?: Date): Promise<PermissionActor> {
  const person = await prisma.person.create({ data: { name: `M2-003 ${role} ${randomUUID()}` } });
  const account = await prisma.account.create({ data: {
    personId: person.id,
    phone: `137${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    passwordHash: "database-test-only",
    status: "NORMAL",
  } });
  await prisma.roleAssignment.create({ data: {
    personId: person.id,
    roleCode: role,
    effectiveAt: new Date("2025-01-01T00:00:00Z"),
    expiredAt: roleExpiredAt,
    reason: "M2-003 Presence database fixture",
  } });
  personIds.push(person.id); accountIds.push(account.id);
  const roles = [role];
  return {
    personId: person.id, accountId: account.id, accountStatus: "NORMAL", permissionVersion: BigInt(1),
    effectiveRoles: roles, capabilities: resolveCapabilities(roles, new Set()), specialPermissions: new Set(),
    selfPersonId: person.id, townshipAreaIds: [], departmentAreaIds: [], hasGlobalPublished: true,
    hasGlobalOperational: role === "ADMIN" || role === "SUPER_ADMIN", hasSystem: role === "SUPER_ADMIN",
    currentBatchMember: role === "MEMBER_CURRENT", configurationIssues: [],
  };
}

function body(arrivalAt: string, expectedDepartureAt: string) {
  return { arrivalAt, expectedDepartureAt, origin: "南京", transportMode: "高铁", trainFlightNo: "G100" };
}

beforeAll(async () => {
  [member, alumni, admin, minister, leader, validClassificationMember, expiredMembershipMember, futureMembershipMember, expiredRoleMember] = await Promise.all([
    fixture("MEMBER_CURRENT"), fixture("MEMBER_ALUMNI_PLATFORM"), fixture("ADMIN"), fixture("MINISTER"), fixture("GROUP_LEADER"),
    fixture("MEMBER_CURRENT"), fixture("MEMBER_CURRENT"), fixture("MEMBER_CURRENT"), fixture("MEMBER_CURRENT", new Date("2026-08-27T03:00:00Z")),
  ]);
  const batch = await prisma.batch.create({ data: {
    name: `M2-003 current ${randomUUID()}`, year: 2026, startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), status: "ACTIVE", isCurrent: true,
  } });
  batchId = batch.id;
  batchIds.push(batch.id);
  await prisma.batchMembership.createMany({ data: [
    { personId: member.personId, batchId, startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), status: "ACTIVE" },
    { personId: alumni.personId, batchId, startDate: new Date("2025-01-01"), endDate: new Date("2025-12-31"), status: "INACTIVE" },
    { personId: validClassificationMember.personId, batchId, startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), status: "ACTIVE" },
    { personId: expiredMembershipMember.personId, batchId, startDate: new Date("2026-01-01"), endDate: new Date("2026-08-27"), status: "ACTIVE" },
    { personId: futureMembershipMember.personId, batchId, startDate: new Date("2026-08-28"), endDate: new Date("2027-01-01"), status: "ACTIVE" },
    { personId: expiredRoleMember.personId, batchId, startDate: new Date("2026-01-01"), endDate: new Date("2027-01-01"), status: "ACTIVE" },
  ] });
});

afterAll(async () => {
  await prisma.stateTransitionHistory.deleteMany({ where: { actorPersonId: { in: personIds } } });
  await prisma.auditLog.deleteMany({ where: { actorAccountId: { in: accountIds } } });
  await prisma.presenceReport.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.batchMembership.deleteMany({ where: { OR: [{ personId: { in: personIds } }, { batchId: { in: batchIds } }] } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.roleAssignment.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.$disconnect();
});

describe("M2-003 real MySQL Presence concurrency", () => {
  it("serializes two overlapping creates by locking the Person row", async () => {
    const interval = body("2026-09-01T09:00:00+08:00", "2026-09-01T12:00:00+08:00");
    const results = await Promise.allSettled([
      service.create({ actor: member, body: interval }),
      service.create({ actor: member, body: { ...interval, note: "并发第二条" } }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.find(({ status }) => status === "rejected")).toMatchObject({ status: "rejected", reason: { code: "PRESENCE_INTERVAL_OVERLAP" } });
    expect(await prisma.presenceReport.count({ where: { personId: member.personId, arrivalAt: new Date("2026-09-01T01:00:00Z") } })).toBe(1);
  });

  it("allows adjacent intervals, rejects overlapping updates, and ignores canceled intervals", async () => {
    const first = await service.create({ actor: member, body: body("2026-09-02T09:00:00+08:00", "2026-09-02T12:00:00+08:00") });
    const second = await service.create({ actor: member, body: body("2026-09-02T12:00:00+08:00", "2026-09-02T15:00:00+08:00") });
    await expect(service.updateMine({ actor: member, reportId: second.id, now: new Date("2026-08-27T00:00:00Z"), body: {
      arrivalAt: "2026-09-02T11:00:00+08:00",
    } })).rejects.toMatchObject({ code: "PRESENCE_INTERVAL_OVERLAP" });
    await service.cancelMine({ actor: member, reportId: first.id, now: new Date("2026-08-27T00:00:00Z"), body: { reason: "行程调整" } });
    await expect(service.create({ actor: member, body: body("2026-09-02T09:30:00+08:00", "2026-09-02T11:30:00+08:00") })).resolves.toBeTruthy();
    expect(await prisma.stateTransitionHistory.count({ where: { entityId: first.id, actionCode: "PRESENCE_CANCELED" } })).toBe(1);
  });

  it("keeps admin correction overlap-safe", async () => {
    const first = await service.create({ actor: alumni, body: body("2026-09-03T09:00:00+08:00", "2026-09-03T11:00:00+08:00") });
    const second = await service.create({ actor: alumni, body: body("2026-09-03T13:00:00+08:00", "2026-09-03T15:00:00+08:00") });
    await expect(service.correct({ actor: admin, reportId: second.id, body: {
      changes: { arrivalAt: "2026-09-03T10:00:00+08:00" }, reason: "线下时间核实",
    } })).rejects.toMatchObject({ code: "PRESENCE_INTERVAL_OVERLAP" });
    await expect(service.correct({ actor: admin, reportId: first.id, body: {
      changes: { origin: "扬州" }, reason: "线下来源地核实",
    } })).resolves.toMatchObject({ origin: "扬州" });
    expect(await prisma.auditLog.count({ where: { entityId: first.id, actionCode: "PRESENCE_ADMIN_CORRECTED" } })).toBe(1);
  });
});

describe("M2-003 real MySQL Presence visibility and current derivation", () => {
  const classificationNow = new Date("2026-08-27T04:00:00Z");
  const currentBody = body("2026-08-27T09:00:00+08:00", "2026-08-27T18:00:00+08:00");
  const memberType = async (personId: string) => (await service.current({ actor: admin, now: classificationNow })).items
    .find((item) => item.person.id === personId)?.person.memberType;

  it("classifies a valid current-batch membership with an effective MEMBER_CURRENT role as CURRENT", async () => {
    await service.create({ actor: validClassificationMember, body: currentBody });
    await expect(memberType(validClassificationMember.personId)).resolves.toBe("CURRENT");
  });

  it("classifies an ACTIVE membership whose endDate is not after now as ALUMNI", async () => {
    await service.create({ actor: expiredMembershipMember, body: currentBody });
    await expect(memberType(expiredMembershipMember.personId)).resolves.toBe("ALUMNI");
  });

  it("classifies an ACTIVE membership whose startDate is after now as ALUMNI", async () => {
    await service.create({ actor: futureMembershipMember, body: currentBody });
    await expect(memberType(futureMembershipMember.personId)).resolves.toBe("ALUMNI");
  });

  it("classifies a current membership with an expired MEMBER_CURRENT role as ALUMNI", async () => {
    await service.create({ actor: expiredRoleMember, body: currentBody });
    await expect(memberType(expiredRoleMember.personId)).resolves.toBe("ALUMNI");
  });

  it("fails safe to ALUMNI when multiple ACTIVE current batches exist", async () => {
    const extraBatch = await prisma.batch.create({ data: {
      name: `M2-003 dirty current ${randomUUID()}`,
      year: 2027,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2027-01-01"),
      status: "ACTIVE",
      isCurrent: true,
    } });
    batchIds.push(extraBatch.id);
    try {
      const summary = await service.current({ actor: admin, now: classificationNow });
      expect(summary.items.every(({ person }) => person.memberType === "ALUMNI")).toBe(true);
      expect(summary).toMatchObject({
        currentCount: 0,
        diagnostics: {
          currentActiveBatchCount: 2,
          configurationIssues: ["CURRENT_ACTIVE_BATCH_COUNT_INVALID"],
        },
      });
    } finally {
      await prisma.batch.delete({ where: { id: extraBatch.id } });
    }
  });

  it("fails safe to ALUMNI when no ACTIVE current batch exists", async () => {
    await prisma.batch.update({ where: { id: batchId }, data: { status: "PLANNED" } });
    try {
      const summary = await service.current({ actor: admin, now: classificationNow });
      expect(summary.items.every(({ person }) => person.memberType === "ALUMNI")).toBe(true);
      expect(summary).toMatchObject({
        currentCount: 0,
        diagnostics: {
          currentActiveBatchCount: 0,
          configurationIssues: ["CURRENT_ACTIVE_BATCH_COUNT_INVALID"],
        },
      });
    } finally {
      await prisma.batch.update({ where: { id: batchId }, data: { status: "ACTIVE" } });
    }
  });

  it("deduplicates dirty current rows and distinguishes current from platform alumni", async () => {
    const now = new Date("2026-08-27T04:00:00Z");
    await service.create({ actor: member, body: body("2026-08-27T09:00:00+08:00", "2026-08-27T18:00:00+08:00") });
    await service.create({ actor: alumni, body: body("2026-08-27T10:00:00+08:00", "2026-08-27T17:00:00+08:00") });
    await prisma.presenceReport.create({ data: {
      personId: member.personId, arrivalAt: new Date("2026-08-27T02:00:00Z"), expectedDepartureAt: new Date("2026-08-27T08:00:00Z"), note: "模拟迁移脏数据",
    } });
    const summary = await service.current({ actor: minister, now });
    expect(summary).toMatchObject({ total: 6, currentCount: 2, alumniCount: 4 });
    expect(summary.items.map(({ person }) => person.id)).toEqual(expect.arrayContaining([member.personId, alumni.personId]));
    expect(summary.items.filter(({ person }) => person.id === member.personId)).toHaveLength(1);
    expect(summary.items.find(({ person }) => person.id === member.personId)?.person.memberType).toBe("CURRENT");
    expect(summary.items.find(({ person }) => person.id === alumni.personId)?.person.memberType).toBe("ALUMNI");
    expect(summary).not.toHaveProperty("diagnostics");
    expect(await service.current({ actor: admin, now })).toMatchObject({ diagnostics: { duplicatePersonCount: 1 } });
  });

  it("keeps ended history self/admin-only while coordinators can still view current", async () => {
    await prisma.presenceReport.create({ data: {
      personId: member.personId, arrivalAt: new Date("2026-08-20T01:00:00Z"), expectedDepartureAt: new Date("2026-08-20T09:00:00Z"), note: "本人历史隐私",
    } });
    const mine = await service.listMine({ actor: member, now: new Date("2026-08-27T00:00:00Z") });
    expect(mine.some(({ note, status }) => note === "本人历史隐私" && status === "ENDED")).toBe(true);
    await expect(service.adminHistory({ actor: minister, query: {} })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    await expect(service.adminHistory({ actor: leader, query: {} })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    expect((await service.adminHistory({ actor: admin, query: { keyword: "M2-003 MEMBER_CURRENT" } })).items.some(({ note }) => note === "本人历史隐私")).toBe(true);
    await expect(service.current({ actor: minister, now: new Date("2026-08-27T04:00:00Z") })).resolves.toBeTruthy();
    await expect(service.current({ actor: leader, now: new Date("2026-08-27T04:00:00Z") })).resolves.toBeTruthy();
  });
});
