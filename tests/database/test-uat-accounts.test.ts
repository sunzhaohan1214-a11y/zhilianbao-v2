import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPrismaClient } from "@/lib/db/prisma";
import { hashPassword } from "@/modules/identity/password/password";
import { prepareTestUatAccounts, type TestUatAccountsInput } from "@/operations/test-uat-accounts";

const prisma = getPrismaClient();
const syntheticPrefix = "Synthetic TEST UAT - ";
const created = { personIds: [] as string[], organizationIds: [] as string[], areaIds: [] as string[], batchIds: [] as string[] };
let previousCurrentBatchIds: string[] = [];
let operatorAccountId = "";

function testInput(apply: boolean): TestUatAccountsInput {
  const base = String(Math.floor(10_000_000 + Math.random() * 89_000_000));
  const phone = (offset: number) => `1${String(Number(base) + offset).padStart(10, "0")}`.slice(0, 11);
  return {
    expectedAppVersion: "a".repeat(40), operatorAccountId, apply, confirm: apply ? "PREPARE_SYNTHETIC_TEST_UAT" : undefined,
    phones: {
      superAdmin: phone(1), admin: phone(2), groupLeader: phone(3), minister: phone(4), memberCurrent: phone(5),
      townshipStaff: phone(6), departmentStaff: phone(7), leaderStage2: phone(8), memberAlumni: phone(9),
    },
  };
}

let input: TestUatAccountsInput;

beforeAll(async () => {
  const stale = await prisma.person.findMany({ where: { name: { startsWith: syntheticPrefix } }, select: { id: true } });
  if (stale.length) throw new Error("TEST_UAT_DATABASE_FIXTURE_NOT_CLEAN");
  previousCurrentBatchIds = (await prisma.batch.findMany({ where: { isCurrent: true }, select: { id: true } })).map(({ id }) => id);
  await prisma.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
  const batch = await prisma.batch.create({ data: { name: `TEST UAT ${randomUUID()}`, year: 2026, startDate: new Date("2026-01-01T00:00:00Z"), status: "ACTIVE", isCurrent: true } });
  created.batchIds.push(batch.id);
  const area = await prisma.administrativeArea.create({ data: { name: `TEST UAT ${randomUUID()}`, type: "TOWNSHIP" } });
  created.areaIds.push(area.id);
  const township = await prisma.organization.create({ data: { name: `TEST UAT township ${randomUUID()}`, type: "TOWNSHIP_ORG" } });
  const department = await prisma.organization.create({ data: { name: `TEST UAT department ${randomUUID()}`, type: "DEPARTMENT" } });
  created.organizationIds.push(township.id, department.id);
  await prisma.organizationAreaMapping.create({ data: { organizationId: township.id, areaId: area.id, effectiveAt: new Date("2026-01-01T00:00:00Z") } });
  await prisma.departmentTownshipRelation.create({ data: { departmentOrganizationId: department.id, areaId: area.id, effectiveAt: new Date("2026-01-01T00:00:00Z") } });
  const operator = await prisma.person.create({ data: { name: `TEST UAT operator ${randomUUID()}` } });
  created.personIds.push(operator.id);
  const account = await prisma.account.create({ data: { personId: operator.id, phone: `1${randomUUID().replaceAll("-", "").replace(/\D/g, "").padEnd(10, "7").slice(0, 10)}`, passwordHash: await hashPassword("test-operator-password"), status: "NORMAL", firstPasswordChangedAt: new Date(), confidentialityConfirmedAt: new Date() } });
  operatorAccountId = account.id;
  await prisma.roleAssignment.create({ data: { personId: operator.id, roleCode: "SUPER_ADMIN", effectiveAt: new Date("2026-01-01T00:00:00Z"), reason: "TEST fixture" } });
  expect(account.status).toBe("NORMAL");
  input = testInput(false);
});

afterAll(async () => {
  const synthetic = await prisma.person.findMany({ where: { name: { startsWith: syntheticPrefix } }, select: { id: true } });
  const personIds = [...created.personIds, ...synthetic.map(({ id }) => id)];
  const accountIds = (await prisma.account.findMany({ where: { personId: { in: personIds } }, select: { id: true } })).map(({ id }) => id);
  await prisma.auditLog.deleteMany({ where: { OR: [{ actorPersonId: { in: personIds } }, { actorAccountId: { in: accountIds } }] } });
  await prisma.stateTransitionHistory.deleteMany({ where: { OR: [{ actorPersonId: { in: personIds } }, { entityId: { in: accountIds } }] } });
  await prisma.groupLeaderAssignment.deleteMany({ where: { OR: [{ personId: { in: personIds } }, { grantedByPersonId: { in: personIds } }] } });
  await prisma.roleAssignment.deleteMany({ where: { OR: [{ personId: { in: personIds } }, { grantedByPersonId: { in: personIds } }] } });
  await prisma.batchMembership.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.appointment.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.account.deleteMany({ where: { personId: { in: personIds } } });
  await prisma.person.deleteMany({ where: { id: { in: personIds } } });
  await prisma.organizationAreaMapping.deleteMany({ where: { organizationId: { in: created.organizationIds } } });
  await prisma.departmentTownshipRelation.deleteMany({ where: { departmentOrganizationId: { in: created.organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: created.organizationIds } } });
  await prisma.administrativeArea.deleteMany({ where: { id: { in: created.areaIds } } });
  await prisma.batch.deleteMany({ where: { id: { in: created.batchIds } } });
  if (previousCurrentBatchIds.length) await prisma.batch.updateMany({ where: { id: { in: previousCurrentBatchIds } }, data: { isCurrent: true } });
  await prisma.$disconnect();
});

describe("Stage B synthetic TEST UAT accounts", () => {
  it("plans without writes, applies once, and replays without duplicate state", async () => {
    const environment = { APP_ENV: "test", APP_VERSION: "a".repeat(40) };
    await expect(prepareTestUatAccounts(prisma, input, environment)).resolves.toMatchObject({ mode: "plan", accounts: 9 });
    expect(await prisma.person.count({ where: { name: { startsWith: syntheticPrefix } } })).toBe(0);

    const appliedInput = { ...input, apply: true, confirm: "PREPARE_SYNTHETIC_TEST_UAT" };
    const first = await prepareTestUatAccounts(prisma, appliedInput, environment);
    expect(first).toMatchObject({ mode: "applied", peopleCreated: 9, accountsCreated: 9, rolesCreated: 10, membershipsCreated: 3, appointmentsCreated: 2, groupLeaderAssignmentsCreated: 1 });
    const auditCount = await prisma.auditLog.count({ where: { actionCode: "SYNTHETIC_TEST_UAT_MATRIX_PREPARED" } });
    expect(await prisma.auditLog.count({ where: { actionCode: "ACCOUNT_PROVISIONED", entityType: "ACCOUNT", actorPersonId: created.personIds[0] } })).toBe(9);
    expect(await prisma.auditLog.count({ where: { actionCode: "ACCOUNT_ENABLED", entityType: "ACCOUNT", actorPersonId: created.personIds[0] } })).toBe(9);
    expect(await prisma.stateTransitionHistory.count({ where: { entityType: "ACCOUNT", actionCode: "ACCOUNT_PROVISIONED", toState: "PENDING_ENABLE" } })).toBeGreaterThanOrEqual(9);
    expect(await prisma.stateTransitionHistory.count({ where: { entityType: "ACCOUNT", actionCode: "ACCOUNT_ENABLED", fromState: "PENDING_ENABLE", toState: "UNACTIVATED" } })).toBeGreaterThanOrEqual(9);
    expect(await prisma.account.count({ where: { person: { name: { startsWith: syntheticPrefix } }, permissionVersion: { gt: 0 } } })).toBe(9);
    const second = await prepareTestUatAccounts(prisma, appliedInput, environment);
    expect(second).toMatchObject({ peopleCreated: 0, accountsCreated: 0, rolesCreated: 0, membershipsCreated: 0, appointmentsCreated: 0, groupLeaderAssignmentsCreated: 0 });
    expect(await prisma.auditLog.count({ where: { actionCode: "SYNTHETIC_TEST_UAT_MATRIX_PREPARED" } })).toBe(auditCount);
    expect(await prisma.account.count({ where: { person: { name: { startsWith: syntheticPrefix } }, status: "UNACTIVATED", forcePasswordChange: true } })).toBe(9);
  });
});
