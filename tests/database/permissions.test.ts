import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { login } from "@/modules/identity/auth-service";
import { hashPassword } from "@/modules/identity/password/password";
import { getCurrentSessionByToken, type CurrentSession } from "@/modules/identity/session-service";
import {
  authorizeActor,
  grantReimbursementApply,
  grantReimbursementManage,
  grantRole,
  resolvePermissionActor,
  revokeReimbursementApply,
  revokeRole,
  type PermissionActor,
} from "@/modules/permissions";

const prisma = getPrismaClient();
const personIds: string[] = [];
const organizationIds: string[] = [];
const areaIds: string[] = [];
const batchIds: string[] = [];
let currentBatchId: string;

function phone(): string {
  return `137${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
}

async function accountFixture(name: string) {
  const password = "permission-test-password";
  const person = await prisma.person.create({ data: { name: `M0-004 ${name} ${randomUUID()}` } });
  personIds.push(person.id);
  const account = await prisma.account.create({
    data: {
      personId: person.id,
      phone: phone(),
      passwordHash: await hashPassword(password),
      status: "NORMAL",
      firstPasswordChangedAt: new Date(),
      confidentialityConfirmedAt: new Date(),
    },
  });
  return { person, account, password };
}

async function addRole(personId: string, roleCode: RoleCode) {
  return prisma.roleAssignment.create({
    data: {
      personId,
      roleCode,
      effectiveAt: new Date(Date.now() - 60_000),
      reason: "M0-004 integration fixture",
    },
  });
}

function sessionFor(fixture: Awaited<ReturnType<typeof accountFixture>>, version = fixture.account.permissionVersion): CurrentSession {
  return {
    sessionId: randomUUID(),
    accountId: fixture.account.id,
    personId: fixture.person.id,
    name: fixture.person.name,
    phone: fixture.account.phone,
    accountStatus: "NORMAL",
    forcePasswordChange: false,
    confidentialityConfirmedAt: fixture.account.confidentialityConfirmedAt,
    permissionVersion: version,
    deviceId: "permission-test",
    roles: [],
  };
}

async function freshActor(fixture: Awaited<ReturnType<typeof accountFixture>>): Promise<PermissionActor> {
  const account = await prisma.account.findUniqueOrThrow({ where: { id: fixture.account.id } });
  return resolvePermissionActor(sessionFor(fixture, account.permissionVersion));
}

async function area(name: string) {
  const value = await prisma.administrativeArea.create({
    data: { name: `M0-004 ${name} ${randomUUID()}`, type: "TOWNSHIP" },
  });
  areaIds.push(value.id);
  return value;
}

async function organization(name: string, type: "TOWNSHIP_ORG" | "DEPARTMENT") {
  const value = await prisma.organization.create({
    data: { name: `M0-004 ${name} ${randomUUID()}`, type },
  });
  organizationIds.push(value.id);
  return value;
}

beforeAll(async () => {
  await prisma.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
  const batch = await prisma.batch.create({
    data: {
      name: `M0-004 current ${randomUUID()}`,
      year: 2026,
      startDate: new Date("2026-01-01T00:00:00.000Z"),
      endDate: new Date("2027-01-01T00:00:00.000Z"),
      status: "ACTIVE",
      isCurrent: true,
    },
  });
  currentBatchId = batch.id;
  batchIds.push(batch.id);
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({
    where: { OR: [{ actorPersonId: { in: personIds } }, { actorAccountId: { in: (await prisma.account.findMany({ where: { personId: { in: personIds } }, select: { id: true } })).map(({ id }) => id) } }] },
  });
  await prisma.session.deleteMany({ where: { account: { personId: { in: personIds } } } });
  await prisma.groupLeaderAssignment.deleteMany({ where: { OR: [{ personId: { in: personIds } }, { grantedByPersonId: { in: personIds } }] } });
  await prisma.specialPermissionGrant.deleteMany({ where: { OR: [{ personId: { in: personIds } }, { grantedByPersonId: { in: personIds } }] } });
  await prisma.roleAssignment.deleteMany({ where: { OR: [{ personId: { in: personIds } }, { grantedByPersonId: { in: personIds } }] } });
  await prisma.batchMembership.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.appointment.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.account.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.organizationAreaMapping.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.departmentTownshipRelation.deleteMany({ where: { departmentOrganizationId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.administrativeArea.deleteMany({ where: { id: { in: areaIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: batchIds } } });
  await prisma.$disconnect();
});

describe("M0-004 real MySQL actor and scope resolution", () => {
  it("limits township scope to active appointment mappings and removes it immediately on expiry", async () => {
    const fixture = await accountFixture("township");
    const areaA = await area("township A");
    const areaB = await area("township B");
    const township = await organization("township org", "TOWNSHIP_ORG");
    await addRole(fixture.person.id, "TOWNSHIP_STAFF");
    await prisma.organizationAreaMapping.create({
      data: { organizationId: township.id, areaId: areaA.id, effectiveAt: new Date(Date.now() - 60_000) },
    });
    const appointment = await prisma.appointment.create({
      data: {
        personId: fixture.person.id,
        organizationId: township.id,
        positionTitle: "经办人",
        effectiveAt: new Date(Date.now() - 60_000),
      },
    });

    const actor = await freshActor(fixture);
    expect(actor.effectiveRoles).toContain("TOWNSHIP_STAFF");
    expect(actor.townshipAreaIds).toEqual([areaA.id]);
    await expect(authorizeActor({
      actor,
      action: "demand.formal.create",
      resource: { resourceType: "demand", areaId: areaA.id },
    })).resolves.toMatchObject({ allowed: true });
    await expect(authorizeActor({
      actor,
      action: "demand.formal.create",
      resource: { resourceType: "demand", areaId: areaB.id },
    })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });

    await prisma.administrativeArea.update({ where: { id: areaA.id }, data: { status: "INACTIVE" } });
    const inactiveArea = await freshActor(fixture);
    expect(inactiveArea.townshipAreaIds).toEqual([]);
    expect(inactiveArea.effectiveRoles).not.toContain("TOWNSHIP_STAFF");
    expect(inactiveArea.capabilities.has("demand.formal.create")).toBe(false);
    await prisma.administrativeArea.update({ where: { id: areaA.id }, data: { status: "ACTIVE" } });

    await prisma.appointment.update({ where: { id: appointment.id }, data: { expiredAt: new Date(Date.now() - 1) } });
    const expired = await freshActor(fixture);
    expect(expired.effectiveRoles).not.toContain("TOWNSHIP_STAFF");
    expect(expired.townshipAreaIds).toEqual([]);
    expect(expired.capabilities.has("demand.formal.create")).toBe(false);
  });

  it("resolves only active department-area relations", async () => {
    const fixture = await accountFixture("department");
    const areaA = await area("department A");
    const areaB = await area("department B");
    const department = await organization("department org", "DEPARTMENT");
    await addRole(fixture.person.id, "DEPARTMENT_STAFF");
    await prisma.appointment.create({
      data: {
        personId: fixture.person.id,
        organizationId: department.id,
        positionTitle: "工作人员",
        effectiveAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.departmentTownshipRelation.createMany({
      data: [areaA.id, areaB.id].map((areaId) => ({
        departmentOrganizationId: department.id,
        areaId,
        effectiveAt: new Date(Date.now() - 60_000),
      })),
    });
    const initial = await freshActor(fixture);
    expect(new Set(initial.departmentAreaIds)).toEqual(new Set([areaA.id, areaB.id]));
    await prisma.departmentTownshipRelation.updateMany({
      where: { departmentOrganizationId: department.id, areaId: areaB.id },
      data: { expiredAt: new Date(Date.now() - 1) },
    });
    const updated = await freshActor(fixture);
    expect(updated.departmentAreaIds).toEqual([areaA.id]);

    await prisma.administrativeArea.update({ where: { id: areaA.id }, data: { status: "INACTIVE" } });
    const inactiveArea = await freshActor(fixture);
    expect(inactiveArea.departmentAreaIds).toEqual([]);
    expect(inactiveArea.effectiveRoles).not.toContain("DEPARTMENT_STAFF");
    expect(inactiveArea.capabilities.has("demand.formal.create")).toBe(false);
  });

  it("requires current membership and group-leader support while minister stays independent", async () => {
    const member = await accountFixture("member");
    await addRole(member.person.id, "MEMBER_CURRENT");
    expect((await freshActor(member)).capabilities.has("demand.claim")).toBe(false);
    await prisma.batchMembership.create({
      data: {
        personId: member.person.id,
        batchId: currentBatchId,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2027-01-01T00:00:00.000Z"),
        status: "ACTIVE",
      },
    });
    expect((await freshActor(member)).capabilities.has("demand.claim")).toBe(true);

    await addRole(member.person.id, "GROUP_LEADER");
    expect((await freshActor(member)).capabilities.has("team.overview.view")).toBe(false);
    await prisma.groupLeaderAssignment.create({
      data: {
        personId: member.person.id,
        batchId: currentBatchId,
        effectiveAt: new Date(Date.now() - 60_000),
        grantedByPersonId: member.person.id,
        reason: "M0-004 valid current leader fixture",
      },
    });
    expect((await freshActor(member)).capabilities.has("team.overview.view")).toBe(true);

    await prisma.batch.update({ where: { id: currentBatchId }, data: { status: "CLOSED" } });
    try {
      const closedBatch = await freshActor(member);
      expect(closedBatch.currentBatchId).toBeUndefined();
      expect(closedBatch.currentBatchMember).toBe(false);
      expect(closedBatch.configurationIssues).toContain("CURRENT_BATCH_COUNT_INVALID");
      expect(closedBatch.effectiveRoles).not.toContain("MEMBER_CURRENT");
      expect(closedBatch.effectiveRoles).not.toContain("GROUP_LEADER");
      expect(closedBatch.capabilities.has("demand.claim")).toBe(false);
      expect(closedBatch.capabilities.has("team.overview.view")).toBe(false);
    } finally {
      await prisma.batch.update({ where: { id: currentBatchId }, data: { status: "ACTIVE" } });
    }

    const secondCurrentBatch = await prisma.batch.create({
      data: {
        name: `M0-004 second current ${randomUUID()}`,
        year: 2027,
        startDate: new Date("2027-01-01T00:00:00.000Z"),
        endDate: new Date("2028-01-01T00:00:00.000Z"),
        status: "ACTIVE",
        isCurrent: true,
      },
    });
    batchIds.push(secondCurrentBatch.id);
    try {
      const ambiguousBatch = await freshActor(member);
      expect(ambiguousBatch.currentBatchId).toBeUndefined();
      expect(ambiguousBatch.currentBatchMember).toBe(false);
      expect(ambiguousBatch.configurationIssues).toContain("CURRENT_BATCH_COUNT_INVALID");
      expect(ambiguousBatch.effectiveRoles).not.toContain("MEMBER_CURRENT");
      expect(ambiguousBatch.effectiveRoles).not.toContain("GROUP_LEADER");
      expect(ambiguousBatch.capabilities.has("demand.claim")).toBe(false);
      expect(ambiguousBatch.capabilities.has("team.overview.view")).toBe(false);
    } finally {
      await prisma.batch.update({ where: { id: secondCurrentBatch.id }, data: { isCurrent: false } });
    }

    const restoredBatch = await freshActor(member);
    expect(restoredBatch.effectiveRoles).toEqual(expect.arrayContaining(["MEMBER_CURRENT", "GROUP_LEADER"]));
    expect(restoredBatch.capabilities.has("demand.claim")).toBe(true);
    expect(restoredBatch.capabilities.has("team.overview.view")).toBe(true);

    const minister = await accountFixture("minister");
    await addRole(minister.person.id, "MINISTER");
    const ministerActor = await freshActor(minister);
    expect(ministerActor.capabilities.has("team.overview.view")).toBe(true);
    expect(ministerActor.capabilities.has("demand.claim")).toBe(false);
    expect(ministerActor.capabilities.has("reimbursement.create")).toBe(false);
    expect(ministerActor.capabilities.has("help.create")).toBe(false);
  });
});

describe("M0-004 grant, revoke, concurrency, audit, and session invalidation", () => {
  it("enforces grant authority, bumps version, audits, and preserves revoked history", async () => {
    const superFixture = await accountFixture("super grantor");
    await addRole(superFixture.person.id, "SUPER_ADMIN");
    const superActor = await freshActor(superFixture);
    const adminFixture = await accountFixture("admin grantor");
    await addRole(adminFixture.person.id, "ADMIN");
    const adminActor = await freshActor(adminFixture);
    const target = await accountFixture("minister target");

    await expect(grantRole({
      actor: adminActor,
      targetPersonId: target.person.id,
      roleCode: "MINISTER",
      reason: "admin must not grant minister",
    })).rejects.toMatchObject({ code: "FORBIDDEN_SENSITIVE_PERMISSION" });

    const oldVersionSession = sessionFor(target);
    const granted = await grantRole({
      actor: superActor,
      targetPersonId: target.person.id,
      roleCode: "MINISTER",
      reason: "正式任命部长",
      context: { requestId: randomUUID(), ip: "127.0.0.1", device: "Vitest" },
    });
    await expect(resolvePermissionActor(oldVersionSession)).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect((await freshActor(target)).effectiveRoles).toContain("MINISTER");
    expect(await prisma.auditLog.count({ where: { actionCode: "ROLE_GRANTED", entityId: granted.id } })).toBe(1);

    await revokeRole({
      actor: superActor,
      targetPersonId: target.person.id,
      roleCode: "MINISTER",
      reason: "部长授权期结束",
    });
    const historical = await prisma.roleAssignment.findUniqueOrThrow({ where: { id: granted.id } });
    expect(historical.expiredAt).not.toBeNull();
    expect((await freshActor(target)).effectiveRoles).not.toContain("MINISTER");
  });

  it("allows ADMIN to grant alumni apply only and reserves manage for SUPER", async () => {
    const superFixture = await accountFixture("super special");
    await addRole(superFixture.person.id, "SUPER_ADMIN");
    const superActor = await freshActor(superFixture);
    const adminFixture = await accountFixture("admin special");
    await addRole(adminFixture.person.id, "ADMIN");
    const adminActor = await freshActor(adminFixture);
    const alumni = await accountFixture("alumni special");
    await addRole(alumni.person.id, "MEMBER_ALUMNI_PLATFORM");
    await prisma.batchMembership.create({
      data: {
        personId: alumni.person.id,
        batchId: currentBatchId,
        startDate: new Date("2024-01-01T00:00:00.000Z"),
        endDate: new Date("2025-01-01T00:00:00.000Z"),
        status: "INACTIVE",
      },
    });

    const applyGrant = await grantReimbursementApply({
      actor: adminActor,
      targetPersonId: alumni.person.id,
      reason: "往届临时参与活动",
    });
    const alumniActor = await freshActor(alumni);
    expect(alumniActor.capabilities.has("reimbursement.create")).toBe(true);
    expect(adminActor.capabilities.has("reimbursement.manage.review")).toBe(false);
    await expect(grantReimbursementManage({
      actor: adminActor,
      targetPersonId: alumni.person.id,
      reason: "ordinary admin cannot grant manage",
    })).rejects.toMatchObject({ code: "FORBIDDEN_SENSITIVE_PERMISSION" });
    await grantReimbursementManage({
      actor: superActor,
      targetPersonId: alumni.person.id,
      reason: "指定报销管理人员",
    });
    expect((await freshActor(alumni)).capabilities.has("reimbursement.manage.review")).toBe(true);

    await revokeReimbursementApply({
      actor: adminActor,
      targetPersonId: alumni.person.id,
      reason: "临时申请权限结束",
    });
    expect((await freshActor(alumni)).capabilities.has("reimbursement.create")).toBe(false);
    expect((await prisma.specialPermissionGrant.findUniqueOrThrow({ where: { id: applyGrant.id } })).expiredAt).not.toBeNull();
  });

  it("revokes current and future role grants in one mutation and cancels future-only grants", async () => {
    const superFixture = await accountFixture("role lifecycle super");
    await addRole(superFixture.person.id, "SUPER_ADMIN");
    const superActor = await freshActor(superFixture);
    const target = await accountFixture("role lifecycle target");
    const currentEffectiveAt = new Date(Date.now() - 60_000);
    const futureEffectiveAt = new Date(Date.now() + 86_400_000);
    const [currentGrant, futureGrant] = await Promise.all([
      prisma.roleAssignment.create({
        data: {
          personId: target.person.id,
          roleCode: "MINISTER",
          effectiveAt: currentEffectiveAt,
          grantedByPersonId: superActor.personId,
          reason: "current lifecycle fixture",
        },
      }),
      prisma.roleAssignment.create({
        data: {
          personId: target.person.id,
          roleCode: "MINISTER",
          effectiveAt: futureEffectiveAt,
          grantedByPersonId: superActor.personId,
          reason: "future lifecycle fixture",
        },
      }),
    ]);
    const versionBefore = (await prisma.account.findUniqueOrThrow({ where: { id: target.account.id } })).permissionVersion;
    const requestId = randomUUID();
    const revoked = await revokeRole({
      actor: superActor,
      targetPersonId: target.person.id,
      roleCode: "MINISTER",
      reason: "cancel current and scheduled minister grants",
      context: { requestId },
    });
    expect(new Set(revoked.currentGrantIds)).toEqual(new Set([currentGrant.id]));
    expect(new Set(revoked.futureGrantIds)).toEqual(new Set([futureGrant.id]));
    const [currentAfter, futureAfter, accountAfter, audit] = await Promise.all([
      prisma.roleAssignment.findUniqueOrThrow({ where: { id: currentGrant.id } }),
      prisma.roleAssignment.findUniqueOrThrow({ where: { id: futureGrant.id } }),
      prisma.account.findUniqueOrThrow({ where: { id: target.account.id } }),
      prisma.auditLog.findFirstOrThrow({ where: { actionCode: "ROLE_REVOKED", requestId } }),
    ]);
    expect(currentAfter.expiredAt?.getTime()).toBeGreaterThanOrEqual(currentEffectiveAt.getTime());
    expect(currentAfter.expiredAt?.getTime()).toBeLessThan(futureEffectiveAt.getTime());
    expect(futureAfter.expiredAt).toEqual(futureEffectiveAt);
    expect(accountAfter.permissionVersion).toBe(versionBefore + BigInt(1));
    expect(audit.beforeJson).toMatchObject({
      currentGrantIds: [currentGrant.id],
      futureGrantIds: [futureGrant.id],
    });
    expect(audit.afterJson).toMatchObject({
      revokedAt: expect.any(String),
      currentGrantsExpiredAtRevokeTime: [{ id: currentGrant.id, expiredAt: expect.any(String) }],
      futureGrantsCanceledAtEffectiveTime: [{ id: futureGrant.id, expiredAt: futureEffectiveAt.toISOString() }],
    });

    const futureOnlyTarget = await accountFixture("future-only role target");
    const futureOnlyEffectiveAt = new Date(Date.now() + 172_800_000);
    const futureOnlyGrant = await prisma.roleAssignment.create({
      data: {
        personId: futureOnlyTarget.person.id,
        roleCode: "MINISTER",
        effectiveAt: futureOnlyEffectiveAt,
        grantedByPersonId: superActor.personId,
        reason: "future-only lifecycle fixture",
      },
    });
    const futureOnlyVersion = (await prisma.account.findUniqueOrThrow({ where: { id: futureOnlyTarget.account.id } })).permissionVersion;
    const futureOnlyRevoked = await revokeRole({
      actor: superActor,
      targetPersonId: futureOnlyTarget.person.id,
      roleCode: "MINISTER",
      reason: "cancel future-only minister grant",
    });
    expect(futureOnlyRevoked.currentGrantIds).toEqual([]);
    expect(futureOnlyRevoked.futureGrantIds).toEqual([futureOnlyGrant.id]);
    expect((await prisma.roleAssignment.findUniqueOrThrow({ where: { id: futureOnlyGrant.id } })).expiredAt)
      .toEqual(futureOnlyEffectiveAt);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: futureOnlyTarget.account.id } })).permissionVersion)
      .toBe(futureOnlyVersion + BigInt(1));
  });

  it("revokes current and future special-permission grants in one mutation", async () => {
    const superFixture = await accountFixture("special lifecycle super");
    await addRole(superFixture.person.id, "SUPER_ADMIN");
    const superActor = await freshActor(superFixture);
    const target = await accountFixture("special lifecycle target");
    const currentEffectiveAt = new Date(Date.now() - 60_000);
    const futureEffectiveAt = new Date(Date.now() + 86_400_000);
    const [currentGrant, futureGrant] = await Promise.all([
      prisma.specialPermissionGrant.create({
        data: {
          personId: target.person.id,
          permissionCode: "reimbursement.apply",
          effectiveAt: currentEffectiveAt,
          reason: "current special lifecycle fixture",
          grantedByPersonId: superActor.personId,
        },
      }),
      prisma.specialPermissionGrant.create({
        data: {
          personId: target.person.id,
          permissionCode: "reimbursement.apply",
          effectiveAt: futureEffectiveAt,
          reason: "future special lifecycle fixture",
          grantedByPersonId: superActor.personId,
        },
      }),
    ]);
    const versionBefore = (await prisma.account.findUniqueOrThrow({ where: { id: target.account.id } })).permissionVersion;
    const requestId = randomUUID();
    const revoked = await revokeReimbursementApply({
      actor: superActor,
      targetPersonId: target.person.id,
      reason: "cancel current and scheduled reimbursement grants",
      context: { requestId },
    });
    expect(new Set(revoked.currentGrantIds)).toEqual(new Set([currentGrant.id]));
    expect(new Set(revoked.futureGrantIds)).toEqual(new Set([futureGrant.id]));
    const [currentAfter, futureAfter, accountAfter, audit] = await Promise.all([
      prisma.specialPermissionGrant.findUniqueOrThrow({ where: { id: currentGrant.id } }),
      prisma.specialPermissionGrant.findUniqueOrThrow({ where: { id: futureGrant.id } }),
      prisma.account.findUniqueOrThrow({ where: { id: target.account.id } }),
      prisma.auditLog.findFirstOrThrow({ where: { actionCode: "SPECIAL_PERMISSION_REVOKED", requestId } }),
    ]);
    expect(currentAfter.expiredAt?.getTime()).toBeGreaterThanOrEqual(currentEffectiveAt.getTime());
    expect(currentAfter.expiredAt?.getTime()).toBeLessThan(futureEffectiveAt.getTime());
    expect(futureAfter.expiredAt).toEqual(futureEffectiveAt);
    expect(accountAfter.permissionVersion).toBe(versionBefore + BigInt(1));
    expect(audit.beforeJson).toMatchObject({
      currentGrantIds: [currentGrant.id],
      futureGrantIds: [futureGrant.id],
    });
    expect(audit.afterJson).toMatchObject({
      revokedAt: expect.any(String),
      currentGrantsExpiredAtRevokeTime: [{ id: currentGrant.id, expiredAt: expect.any(String) }],
      futureGrantsCanceledAtEffectiveTime: [{ id: futureGrant.id, expiredAt: futureEffectiveAt.toISOString() }],
    });
  });

  it("serializes truly concurrent duplicate role and special grants", async () => {
    const superFixture = await accountFixture("super concurrency");
    await addRole(superFixture.person.id, "SUPER_ADMIN");
    const superActor = await freshActor(superFixture);
    const roleTarget = await accountFixture("role concurrency target");
    const roleResults = await Promise.allSettled([1, 2].map((attempt) => grantRole({
      actor: superActor,
      targetPersonId: roleTarget.person.id,
      roleCode: "MINISTER",
      reason: `concurrent minister grant ${attempt}`,
    })));
    expect(roleResults.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await prisma.roleAssignment.count({
      where: { personId: roleTarget.person.id, roleCode: "MINISTER", expiredAt: null },
    })).toBe(1);

    const specialTarget = await accountFixture("special concurrency target");
    await addRole(specialTarget.person.id, "MEMBER_ALUMNI_PLATFORM");
    await prisma.batchMembership.create({
      data: {
        personId: specialTarget.person.id,
        batchId: currentBatchId,
        startDate: new Date("2023-01-01T00:00:00.000Z"),
        endDate: new Date("2024-01-01T00:00:00.000Z"),
        status: "INACTIVE",
      },
    });
    const specialResults = await Promise.allSettled([1, 2].map((attempt) => grantReimbursementApply({
      actor: superActor,
      targetPersonId: specialTarget.person.id,
      reason: `concurrent apply grant ${attempt}`,
    })));
    expect(specialResults.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await prisma.specialPermissionGrant.count({
      where: { personId: specialTarget.person.id, permissionCode: "reimbursement.apply", expiredAt: null },
    })).toBe(1);
  });

  it("invalidates a real M0-003 database session on the next request", async () => {
    const superFixture = await accountFixture("super session");
    await addRole(superFixture.person.id, "SUPER_ADMIN");
    const superActor = await freshActor(superFixture);
    const target = await accountFixture("session target");
    const issued = await login(
      { phone: target.account.phone, password: target.password },
      { ip: "10.99.0.1", userAgent: "Permission session test", deviceId: randomUUID(), deviceName: "Vitest", requestId: randomUUID() },
    );
    expect(await getCurrentSessionByToken(issued.rawToken)).not.toBeNull();
    await grantRole({
      actor: superActor,
      targetPersonId: target.person.id,
      roleCode: "MINISTER",
      reason: "验证权限版本即时失效",
    });
    expect(await getCurrentSessionByToken(issued.rawToken)).toBeNull();
  });
});
