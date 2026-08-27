import type { Prisma } from "@/generated/prisma/client";
import type { AuthRequestContext } from "@/modules/identity/request-context";
import type { PermissionActor } from "@/modules/permissions/types";

export type PresenceMutationContext = Pick<AuthRequestContext, "requestId" | "ip" | "deviceName">;

export async function writePresenceAudit(
  tx: Prisma.TransactionClient,
  input: {
    actor: PermissionActor;
    actionCode: "PRESENCE_CREATED" | "PRESENCE_UPDATED" | "PRESENCE_CANCELED" | "PRESENCE_ADMIN_CORRECTED";
    entityId: string;
    before?: Prisma.InputJsonObject;
    after?: Prisma.InputJsonObject;
    reason?: string;
    context?: PresenceMutationContext;
  },
) {
  await tx.auditLog.create({ data: {
    actorPersonId: input.actor.personId,
    actorAccountId: input.actor.accountId,
    actionCode: input.actionCode,
    entityType: "PRESENCE_REPORT",
    entityId: input.entityId,
    beforeJson: input.before,
    afterJson: input.after,
    reason: input.reason,
    requestId: input.context?.requestId?.slice(0, 100),
    ip: input.context?.ip?.slice(0, 45),
    device: input.context?.deviceName?.slice(0, 255),
  } });
}

export async function writePresenceTransition(
  tx: Prisma.TransactionClient,
  input: {
    actor: PermissionActor;
    entityId: string;
    fromState?: string;
    toState: string;
    actionCode: "PRESENCE_CANCELED" | "PRESENCE_ADMIN_CORRECTED";
    reason: string;
    context?: PresenceMutationContext;
  },
) {
  await tx.stateTransitionHistory.create({ data: {
    entityType: "PRESENCE_REPORT",
    entityId: input.entityId,
    fromState: input.fromState,
    toState: input.toState,
    actionCode: input.actionCode,
    actorPersonId: input.actor.personId,
    reason: input.reason,
    requestId: input.context?.requestId?.slice(0, 100),
  } });
}
