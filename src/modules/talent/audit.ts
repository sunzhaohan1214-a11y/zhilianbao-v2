import type { Prisma } from "@/generated/prisma/client";
import type { AuthRequestContext } from "@/modules/identity/request-context";
import type { PermissionActor } from "@/modules/permissions/types";
export type TalentMutationContext = Pick<
  AuthRequestContext,
  "requestId" | "ip" | "deviceName"
>;
type Common = {
  actor: PermissionActor;
  entityType: string;
  entityId: string;
  actionCode: string;
  reason?: string;
  context?: TalentMutationContext;
};
export async function writeTalentAudit(
  tx: Prisma.TransactionClient,
  input: Common & {
    before?: Prisma.InputJsonObject;
    after?: Prisma.InputJsonObject;
  },
) {
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
      requestId: input.context?.requestId.slice(0, 100),
      ip: input.context?.ip.slice(0, 45),
      device: input.context?.deviceName.slice(0, 255),
    },
  });
}
export async function writeTalentTransition(
  tx: Prisma.TransactionClient,
  input: Common & {
    fromState?: string;
    toState: string;
    metadata?: Prisma.InputJsonObject;
  },
) {
  await tx.stateTransitionHistory.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      fromState: input.fromState,
      toState: input.toState,
      actionCode: input.actionCode,
      actorPersonId: input.actor.personId,
      reason: input.reason,
      metadataJson: input.metadata,
      requestId: input.context?.requestId.slice(0, 100),
    },
  });
}
