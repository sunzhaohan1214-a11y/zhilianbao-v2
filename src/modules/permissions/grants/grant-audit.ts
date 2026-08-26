import type { Prisma } from "@/generated/prisma/client";
import type { PermissionActor } from "../types";

export type GrantRequestContext = {
  requestId?: string;
  ip?: string;
  device?: string;
};

export async function writeGrantAudit(
  tx: Prisma.TransactionClient,
  input: {
    actor: PermissionActor;
    actionCode: "ROLE_GRANTED" | "ROLE_REVOKED" | "SPECIAL_PERMISSION_GRANTED" | "SPECIAL_PERMISSION_REVOKED";
    entityType: "ROLE_ASSIGNMENT" | "SPECIAL_PERMISSION_GRANT";
    entityId?: string;
    reason: string;
    before?: Prisma.InputJsonObject;
    after?: Prisma.InputJsonObject;
    context?: GrantRequestContext;
  },
): Promise<void> {
  await tx.auditLog.create({
    data: {
      actorPersonId: input.actor.personId,
      actorAccountId: input.actor.accountId,
      actionCode: input.actionCode,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeJson: input.before,
      afterJson: input.after,
      reason: input.reason,
      ip: input.context?.ip?.slice(0, 45),
      device: input.context?.device?.slice(0, 255),
      requestId: input.context?.requestId?.slice(0, 100),
    },
  });
}
