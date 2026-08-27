import type { Prisma } from "@/generated/prisma/client";
import { effectiveAt } from "@/modules/permissions/effective";

const validPerson = {
  personStatus: "ACTIVE" as const,
  account: { is: { status: "NORMAL" as const } },
};

export async function activeReimbursementManagers(tx: Prisma.TransactionClient, now = new Date()): Promise<string[]> {
  const [grants, superAdmins] = await Promise.all([
    tx.specialPermissionGrant.findMany({
      where: { permissionCode: "reimbursement.manage", ...effectiveAt(now), person: validPerson },
      select: { personId: true },
    }),
    tx.roleAssignment.findMany({
      where: { roleCode: "SUPER_ADMIN", ...effectiveAt(now), person: validPerson },
      select: { personId: true },
    }),
  ]);
  return [...new Set([...grants, ...superAdmins].map(({ personId }) => personId))].sort();
}
