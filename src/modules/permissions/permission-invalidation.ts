import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";

type InvalidationClient = Prisma.TransactionClient | ReturnType<typeof getPrismaClient>;

export async function bumpPermissionVersion(
  personId: string,
  client: InvalidationClient = getPrismaClient(),
): Promise<void> {
  const result = await client.account.updateMany({
    where: { personId },
    data: { permissionVersion: { increment: 1 } },
  });
  if (result.count !== 1) throw new Error("PERMISSION_ACCOUNT_NOT_FOUND");
}

export async function bumpPermissionVersions(
  personIds: readonly string[],
  client: InvalidationClient = getPrismaClient(),
): Promise<void> {
  const uniquePersonIds = [...new Set(personIds)];
  if (uniquePersonIds.length === 0) return;
  await client.account.updateMany({
    where: { personId: { in: uniquePersonIds } },
    data: { permissionVersion: { increment: 1 } },
  });
}

export const permissionInvalidation = {
  roleAssignmentChanged: bumpPermissionVersion,
  specialPermissionChanged: bumpPermissionVersion,
  appointmentChanged: bumpPermissionVersion,
  batchMembershipChanged: bumpPermissionVersion,
  groupLeaderAssignmentChanged: bumpPermissionVersion,
  organizationAreaMappingChanged: bumpPermissionVersions,
  departmentTownshipRelationChanged: bumpPermissionVersions,
  currentBatchChanged: bumpPermissionVersions,
} as const;
