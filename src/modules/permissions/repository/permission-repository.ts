import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { effectiveAt } from "../effective";

export type PermissionTransaction = Prisma.TransactionClient;

export async function loadPermissionGraph(accountId: string, now: Date) {
  const prisma = getPrismaClient();
  const account = await prisma.account.findUnique({
    where: { id: accountId },
    include: { person: true },
  });
  if (!account) return null;

  const personId = account.personId;
  const [roleAssignments, specialGrants, currentBatches, appointments, memberships, groupLeaderAssignments] =
    await Promise.all([
      prisma.roleAssignment.findMany({
        where: { personId, ...effectiveAt(now) },
        select: { roleCode: true },
      }),
      prisma.specialPermissionGrant.findMany({
        where: { personId, ...effectiveAt(now) },
        select: { permissionCode: true },
      }),
      prisma.batch.findMany({
        where: { isCurrent: true, status: "ACTIVE" },
        select: { id: true },
      }),
      prisma.appointment.findMany({
        where: { personId, ...effectiveAt(now), organization: { status: "ACTIVE" } },
        select: {
          organization: {
            select: {
              id: true,
              type: true,
              areaMappings: {
                where: { ...effectiveAt(now), area: { status: "ACTIVE" } },
                select: { areaId: true },
              },
              departmentAreaRelations: {
                where: { ...effectiveAt(now), area: { status: "ACTIVE" } },
                select: { areaId: true },
              },
            },
          },
        },
      }),
      prisma.batchMembership.findMany({
        where: { personId },
        select: { batchId: true, status: true, startDate: true, endDate: true },
      }),
      prisma.groupLeaderAssignment.findMany({
        where: { personId, ...effectiveAt(now) },
        select: { batchId: true },
      }),
    ]);

  return {
    account,
    roleAssignments,
    specialGrants,
    currentBatches,
    appointments,
    memberships,
    groupLeaderAssignments,
  };
}
export async function lockPermissionTarget(
  tx: PermissionTransaction,
  personId: string,
): Promise<{ accountId: string }> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM accounts WHERE person_id = ${personId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error("PERMISSION_TARGET_ACCOUNT_NOT_FOUND");
  return { accountId: rows[0].id };
}
