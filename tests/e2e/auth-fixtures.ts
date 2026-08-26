import { getPrismaClient } from "@/lib/db/prisma";
import { hashPassword, initialPasswordFromPhone } from "@/modules/identity/password/password";

export const e2eUsers = {
  unactivated: { personId: "10000000-0000-4000-8000-000000000001", accountId: "20000000-0000-4000-8000-000000000001", phone: "13800001001", password: "001001" },
  normal: { personId: "10000000-0000-4000-8000-000000000002", accountId: "20000000-0000-4000-8000-000000000002", phone: "13800001002", password: "Normal-pass-123" },
  admin: { personId: "10000000-0000-4000-8000-000000000003", accountId: "20000000-0000-4000-8000-000000000003", phone: "13800001003", password: "Admin-pass-123" },
  forced: { personId: "10000000-0000-4000-8000-000000000004", accountId: "20000000-0000-4000-8000-000000000004", phone: "13800001004", password: "001004" },
  minister: { personId: "10000000-0000-4000-8000-000000000005", accountId: "20000000-0000-4000-8000-000000000005", phone: "13800001005", password: "Minister-pass-123" },
  groupLeader: { personId: "10000000-0000-4000-8000-000000000006", accountId: "20000000-0000-4000-8000-000000000006", phone: "13800001006", password: "Leader-pass-123" },
  superAdmin: { personId: "10000000-0000-4000-8000-000000000007", accountId: "20000000-0000-4000-8000-000000000007", phone: "13800001007", password: "Super-pass-123" },
} as const;

export async function seedAuthFixtures() {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  if (!/test/i.test(databaseUrl)) throw new Error("E2E auth fixtures require an explicitly named test database");
  const prisma = getPrismaClient();
  const users = Object.values(e2eUsers);
  await prisma.auditLog.deleteMany({ where: { actorAccountId: { in: users.map(({ accountId }) => accountId) } } });
  await prisma.session.deleteMany({ where: { accountId: { in: users.map(({ accountId }) => accountId) } } });
  await prisma.authRateLimitBucket.deleteMany();

  for (const [name, fixture] of Object.entries(e2eUsers)) {
    await prisma.person.upsert({
      where: { id: fixture.personId },
      create: { id: fixture.personId, name: `E2E ${name}` },
      update: { name: `E2E ${name}` },
    });
    const isUnactivated = name === "unactivated";
    const isForced = name === "forced";
    const password = isUnactivated || isForced ? initialPasswordFromPhone(fixture.phone) : fixture.password;
    await prisma.account.upsert({
      where: { id: fixture.accountId },
      create: {
        id: fixture.accountId,
        personId: fixture.personId,
        phone: fixture.phone,
        passwordHash: await hashPassword(password),
        status: isUnactivated ? "UNACTIVATED" : "NORMAL",
        forcePasswordChange: isForced,
        firstPasswordChangedAt: isUnactivated ? null : new Date(),
        confidentialityConfirmedAt: isUnactivated ? null : new Date(),
      },
      update: {
        phone: fixture.phone,
        passwordHash: await hashPassword(password),
        status: isUnactivated ? "UNACTIVATED" : "NORMAL",
        forcePasswordChange: isForced,
        firstPasswordChangedAt: isUnactivated ? null : new Date(),
        confidentialityConfirmedAt: isUnactivated ? null : new Date(),
        permissionVersion: 1,
      },
    });
  }
  await prisma.roleAssignment.deleteMany({ where: { personId: { in: users.map(({ personId }) => personId) } } });
  await prisma.roleAssignment.createMany({
    data: [
      { personId: e2eUsers.admin.personId, roleCode: "ADMIN" as const },
      { personId: e2eUsers.minister.personId, roleCode: "MINISTER" as const },
      { personId: e2eUsers.groupLeader.personId, roleCode: "GROUP_LEADER" as const },
      { personId: e2eUsers.superAdmin.personId, roleCode: "SUPER_ADMIN" as const },
    ].map(({ personId, roleCode }) => ({
      personId,
      roleCode,
      effectiveAt: new Date(Date.now() - 60_000),
      grantedByPersonId: e2eUsers.superAdmin.personId,
      reason: "M0-004 unified permission E2E fixture",
    })),
  });
}
