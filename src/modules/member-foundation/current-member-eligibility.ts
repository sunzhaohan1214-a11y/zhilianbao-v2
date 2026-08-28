import type { Prisma } from "@/generated/prisma/client";
import { classifyMember } from "./rules";

export type CurrentMemberEligibility = {
  eligible: boolean;
  reason?: "CURRENT_BATCH_INVALID" | "PERSON_INACTIVE" | "ACCOUNT_INEFFECTIVE" | "MEMBERSHIP_OR_ROLE_INEFFECTIVE";
  batchId?: string;
  person?: { id: string; name: string };
};

export type CurrentMemberSnapshot = {
  id: string;
  name: string;
  personStatus: string;
  account: { status: string; forcePasswordChange: boolean; confidentialityConfirmedAt: Date | null } | null;
  batchMemberships: Array<{ batchId: string; status: string; startDate: Date; endDate: Date | null }>;
  roleAssignments: Array<{ roleCode: string; effectiveAt: Date; expiredAt: Date | null }>;
};

export function evaluateCurrentMemberSnapshot(
  person: CurrentMemberSnapshot | null,
  currentBatchId: string,
  now = new Date(),
): CurrentMemberEligibility {
  if (!person || person.personStatus !== "ACTIVE") return { eligible: false, reason: "PERSON_INACTIVE" };
  const accountEffective = person.account?.status === "NORMAL"
    && !person.account.forcePasswordChange
    && person.account.confidentialityConfirmedAt !== null;
  if (!accountEffective) {
    return { eligible: false, reason: "ACCOUNT_INEFFECTIVE", person: { id: person.id, name: person.name } };
  }
  const kind = classifyMember({
    memberships: person.batchMemberships,
    roles: person.roleAssignments,
    currentBatchId,
    hasAccount: true,
    now,
  });
  if (kind !== "current") {
    return { eligible: false, reason: "MEMBERSHIP_OR_ROLE_INEFFECTIVE", person: { id: person.id, name: person.name } };
  }
  return { eligible: true, batchId: currentBatchId, person: { id: person.id, name: person.name } };
}

export async function getCurrentMemberEligibility(
  tx: Prisma.TransactionClient,
  personId: string,
  now = new Date(),
): Promise<CurrentMemberEligibility> {
  await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM batches ORDER BY id FOR UPDATE`;
  const currentBatches = await tx.batch.findMany({
    where: { isCurrent: true, status: "ACTIVE" },
    select: { id: true },
    take: 2,
  });
  if (currentBatches.length !== 1) {
    return { eligible: false, reason: "CURRENT_BATCH_INVALID" };
  }

  const people = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM persons WHERE id = ${personId} FOR UPDATE
  `;
  if (people.length !== 1) return { eligible: false, reason: "PERSON_INACTIVE" };
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM accounts WHERE person_id = ${personId} FOR UPDATE
  `;

  const person = await tx.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      name: true,
      personStatus: true,
      account: {
        select: {
          status: true,
          forcePasswordChange: true,
          confidentialityConfirmedAt: true,
        },
      },
      batchMemberships: {
        select: { batchId: true, status: true, startDate: true, endDate: true },
      },
      roleAssignments: {
        select: { roleCode: true, effectiveAt: true, expiredAt: true },
      },
    },
  });
  return evaluateCurrentMemberSnapshot(person, currentBatches[0].id, now);
}
