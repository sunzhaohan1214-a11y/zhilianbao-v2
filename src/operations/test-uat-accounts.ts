import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { Prisma, PrismaClient, RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { hashPassword, initialPasswordFromPhone } from "@/modules/identity/password/password";
import { normalizePhone } from "@/modules/identity/phone";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { bumpPermissionVersion } from "@/modules/permissions/permission-invalidation";
import { loadRuntimeSecret } from "@/runtime/runtime-secret";

const confirmation = "PREPARE_SYNTHETIC_TEST_UAT";
const testAliases = new Set(["test", "testing", "uat", "staging"]);

const matrix = {
  superAdmin: ["SUPER_ADMIN"],
  admin: ["ADMIN"],
  groupLeader: ["MEMBER_CURRENT", "GROUP_LEADER"],
  minister: ["MINISTER"],
  memberCurrent: ["MEMBER_CURRENT"],
  townshipStaff: ["TOWNSHIP_STAFF"],
  departmentStaff: ["DEPARTMENT_STAFF"],
  leaderStage2: ["LEADER_STAGE2"],
  memberAlumni: ["MEMBER_ALUMNI_PLATFORM"],
} as const satisfies Record<string, readonly RoleCode[]>;

type MatrixKey = keyof typeof matrix;

const inputSchema = z.object({
  expectedAppVersion: z.string().regex(/^[0-9a-f]{40}$/),
  operatorAccountId: z.string().uuid(),
  apply: z.boolean().default(false),
  confirm: z.string().optional(),
  phones: z.object({
    superAdmin: z.string(), admin: z.string(), groupLeader: z.string(), minister: z.string(),
    memberCurrent: z.string(), townshipStaff: z.string(), departmentStaff: z.string(),
    leaderStage2: z.string(), memberAlumni: z.string(),
  }).strict(),
}).strict();

export type TestUatAccountsInput = z.infer<typeof inputSchema>;

export function validateTestUatEnvironment(environment: Record<string, string | undefined>, input: TestUatAccountsInput): void {
  const appEnvironment = environment.APP_ENV?.trim().toLowerCase();
  if (!appEnvironment || !testAliases.has(appEnvironment)) throw new Error("TEST_UAT_ENVIRONMENT_FORBIDDEN");
  if (environment.APP_VERSION !== input.expectedAppVersion) throw new Error("TEST_UAT_APP_VERSION_MISMATCH");
  if (input.apply && input.confirm !== confirmation) throw new Error("TEST_UAT_CONFIRMATION_REQUIRED");
}

function activeAt(now: Date): Prisma.RoleAssignmentWhereInput {
  return { effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] };
}

function safeName(key: MatrixKey): string {
  return `Synthetic TEST UAT - ${key}`;
}

async function readInput(): Promise<TestUatAccountsInput> {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.length > 65_536) throw new Error("TEST_UAT_INPUT_TOO_LARGE");
  }
  return inputSchema.parse(JSON.parse(text));
}

export async function prepareTestUatAccounts(
  prisma: PrismaClient,
  rawInput: TestUatAccountsInput,
  environment: Record<string, string | undefined> = process.env,
) {
  const input = inputSchema.parse(rawInput);
  validateTestUatEnvironment(environment, input);
  const phones = Object.fromEntries(Object.entries(input.phones).map(([key, value]) => [key, normalizePhone(value)])) as Record<MatrixKey, string>;
  if (new Set(Object.values(phones)).size !== Object.keys(matrix).length) throw new Error("TEST_UAT_PHONE_DUPLICATE");

  const now = new Date();
  const operator = await prisma.account.findUnique({
    where: {
      id: input.operatorAccountId,
    },
    include: { person: true },
  });
  if (!operator
    || operator.status !== "NORMAL"
    || operator.forcePasswordChange
    || !operator.confidentialityConfirmedAt
    || operator.person.personStatus !== "ACTIVE"
    || operator.person.name.startsWith("Synthetic TEST UAT - ")) {
    throw new Error("TEST_UAT_OPERATOR_INVALID");
  }
  const actor = await resolvePermissionActor({
    sessionId: "test-uat-operation", accountId: operator.id, personId: operator.personId,
    name: operator.person.name, phone: operator.phone, accountStatus: operator.status,
    forcePasswordChange: operator.forcePasswordChange,
    confidentialityConfirmedAt: operator.confidentialityConfirmedAt,
    permissionVersion: operator.permissionVersion, deviceId: "test-uat-operation", roles: ["SUPER_ADMIN"],
  }, now);
  if (!actor.hasSystem) throw new Error("TEST_UAT_OPERATOR_FORBIDDEN");

  const [batches, townshipOrganizations, departmentOrganizations] = await Promise.all([
    prisma.batch.findMany({ where: { isCurrent: true, status: "ACTIVE" } }),
    prisma.organization.findMany({
      where: { type: "TOWNSHIP_ORG", status: "ACTIVE", areaMappings: { some: { effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } } },
      orderBy: { id: "asc" },
    }),
    prisma.organization.findMany({
      where: { type: "DEPARTMENT", status: "ACTIVE", departmentAreaRelations: { some: { effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } } },
      orderBy: { id: "asc" },
    }),
  ]);
  if (batches.length !== 1) throw new Error("TEST_UAT_CURRENT_BATCH_INVALID");
  if (townshipOrganizations.length === 0) throw new Error("TEST_UAT_TOWNSHIP_SCOPE_MISSING");
  if (departmentOrganizations.length === 0) throw new Error("TEST_UAT_DEPARTMENT_SCOPE_MISSING");

  const plan = { accounts: Object.keys(matrix).length, currentBatch: true, townshipScope: true, departmentScope: true };
  if (!input.apply) return { mode: "plan" as const, ...plan };

  const passwordHashes = Object.fromEntries(await Promise.all(Object.entries(phones).map(async ([key, phone]) => [key, await hashPassword(initialPasswordFromPhone(phone))]))) as Record<MatrixKey, string>;
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM batches WHERE id = ${batches[0].id} FOR UPDATE`;
    const counts = { peopleCreated: 0, accountsCreated: 0, rolesCreated: 0, membershipsCreated: 0, appointmentsCreated: 0, groupLeaderAssignmentsCreated: 0 };
    for (const key of Object.keys(matrix) as MatrixKey[]) {
      const name = safeName(key);
      const people = await tx.person.findMany({ where: { name }, include: { account: true } });
      if (people.length > 1) throw new Error("TEST_UAT_PERSON_AMBIGUOUS");
      const phoneAccount = await tx.account.findUnique({ where: { phone: phones[key] } });
      if (people[0]?.account && people[0].account.phone !== phones[key]) throw new Error("TEST_UAT_PERSON_PHONE_CONFLICT");
      if (phoneAccount && phoneAccount.personId !== people[0]?.id) throw new Error("TEST_UAT_PHONE_CONFLICT");
      const person = people[0] ?? await tx.person.create({ data: { name, contactPhone: phones[key] } });
      if (!people[0]) counts.peopleCreated += 1;
      let account = people[0]?.account ?? phoneAccount;
      if (!account) {
        account = await tx.account.create({ data: { personId: person.id, phone: phones[key], passwordHash: passwordHashes[key], status: "PENDING_ENABLE", forcePasswordChange: true } });
        counts.accountsCreated += 1;
        await tx.stateTransitionHistory.create({ data: { entityType: "ACCOUNT", entityId: account.id, toState: "PENDING_ENABLE", actionCode: "ACCOUNT_PROVISIONED", actorPersonId: actor.personId } });
        await tx.auditLog.create({ data: { actorPersonId: actor.personId, actorAccountId: actor.accountId, actionCode: "ACCOUNT_PROVISIONED", entityType: "ACCOUNT", entityId: account.id, reason: "Stage B synthetic TEST UAT" } });
        account = await tx.account.update({ where: { id: account.id }, data: { status: "UNACTIVATED" } });
        await tx.stateTransitionHistory.create({ data: { entityType: "ACCOUNT", entityId: account.id, fromState: "PENDING_ENABLE", toState: "UNACTIVATED", actionCode: "ACCOUNT_ENABLED", actorPersonId: actor.personId } });
        await tx.auditLog.create({ data: { actorPersonId: actor.personId, actorAccountId: actor.accountId, actionCode: "ACCOUNT_ENABLED", entityType: "ACCOUNT", entityId: account.id, reason: "Stage B synthetic TEST UAT" } });
      }
      if (!["UNACTIVATED", "NORMAL"].includes(account.status)) throw new Error("TEST_UAT_ACCOUNT_STATE_CONFLICT");

      let permissionChanged = false;
      const desiredRoles = new Set<RoleCode>(matrix[key]);
      const existingRoles = await tx.roleAssignment.findMany({ where: { personId: person.id, ...activeAt(now) } });
      if (existingRoles.some(({ roleCode }) => !desiredRoles.has(roleCode))) throw new Error("TEST_UAT_ROLE_CONFLICT");
      for (const roleCode of desiredRoles) {
        if (existingRoles.some((role) => role.roleCode === roleCode)) continue;
        const role = await tx.roleAssignment.create({ data: { personId: person.id, roleCode, effectiveAt: now, grantedByPersonId: actor.personId, reason: "Stage B synthetic TEST UAT" } });
        counts.rolesCreated += 1;
        permissionChanged = true;
        await tx.auditLog.create({ data: { actorPersonId: actor.personId, actorAccountId: actor.accountId, actionCode: "ROLE_GRANTED", entityType: "ROLE_ASSIGNMENT", entityId: role.id, reason: "Stage B synthetic TEST UAT", afterJson: { targetPersonId: person.id, roleCode } } });
      }

      if (desiredRoles.has("MEMBER_CURRENT") || desiredRoles.has("MEMBER_ALUMNI_PLATFORM")) {
        const membership = await tx.batchMembership.findUnique({ where: { personId_batchId: { personId: person.id, batchId: batches[0].id } } });
        const status = desiredRoles.has("MEMBER_CURRENT") ? "ACTIVE" : "COMPLETED";
        if (!membership) {
          await tx.batchMembership.create({ data: { personId: person.id, batchId: batches[0].id, startDate: batches[0].startDate, endDate: status === "COMPLETED" ? now : null, status } });
          counts.membershipsCreated += 1;
          permissionChanged = true;
        } else if (membership.status !== status) throw new Error("TEST_UAT_MEMBERSHIP_CONFLICT");
      }
      if (key === "groupLeader") {
        const leaders = await tx.groupLeaderAssignment.findMany({ where: { batchId: batches[0].id, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } });
        if (leaders.some(({ personId }) => personId !== person.id)) throw new Error("TEST_UAT_GROUP_LEADER_CONFLICT");
        if (leaders.length === 0) {
          await tx.groupLeaderAssignment.create({ data: { personId: person.id, batchId: batches[0].id, effectiveAt: now, grantedByPersonId: actor.personId, reason: "Stage B synthetic TEST UAT" } });
          counts.groupLeaderAssignmentsCreated += 1;
          permissionChanged = true;
        }
      }
      const organization = key === "townshipStaff" ? townshipOrganizations[0] : key === "departmentStaff" ? departmentOrganizations[0] : null;
      if (organization) {
        const existing = await tx.appointment.findFirst({ where: { personId: person.id, organizationId: organization.id, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } });
        if (!existing) {
          await tx.appointment.create({ data: { personId: person.id, organizationId: organization.id, positionTitle: "Synthetic TEST UAT", effectiveAt: now, isPrimary: true } });
          counts.appointmentsCreated += 1;
          permissionChanged = true;
        }
      }
      if (permissionChanged) await bumpPermissionVersion(person.id, tx);
    }
    if (Object.values(counts).some((count) => count > 0)) {
      await tx.auditLog.create({ data: { actorPersonId: actor.personId, actorAccountId: actor.accountId, actionCode: "SYNTHETIC_TEST_UAT_MATRIX_PREPARED", entityType: "TEST_UAT_MATRIX", afterJson: { ...plan, synthetic: true }, reason: "Stage B synthetic TEST UAT" } });
    }
    return counts;
  });
  return { mode: "applied" as const, ...plan, ...result };
}

async function main(): Promise<void> {
  const input = await readInput();
  validateTestUatEnvironment(process.env, input);
  await loadRuntimeSecret();
  const result = await prepareTestUatAccounts(getPrismaClient(), input);
  console.log(JSON.stringify(result));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "TEST_UAT_PREPARATION_FAILED");
    process.exitCode = 1;
  });
}
