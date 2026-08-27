import type { Prisma } from "@/generated/prisma/client";
import type { AuthRequestContext } from "@/modules/identity/request-context";
import type { PermissionActor } from "@/modules/permissions/types";

export type ReimbursementMutationContext = Pick<AuthRequestContext, "requestId" | "ip" | "deviceName">;
type Common = { actor: PermissionActor; entityId: string; actionCode: string; reason?: string; context?: ReimbursementMutationContext };
export async function writeReimbursementAudit(tx: Prisma.TransactionClient, input: Common & { before?: Prisma.InputJsonObject; after?: Prisma.InputJsonObject }) {
  await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId,
    actionCode: input.actionCode, entityType: "REIMBURSEMENT", entityId: input.entityId,
    beforeJson: input.before, afterJson: input.after, reason: input.reason,
    requestId: input.context?.requestId.slice(0, 100), ip: input.context?.ip.slice(0, 45), device: input.context?.deviceName.slice(0, 255) } });
}
export async function writeReimbursementTransition(tx: Prisma.TransactionClient, input: Common & { fromState?: string; toState: string; metadata?: Prisma.InputJsonObject }) {
  await tx.stateTransitionHistory.create({ data: { entityType: "REIMBURSEMENT", entityId: input.entityId,
    fromState: input.fromState, toState: input.toState, actionCode: input.actionCode,
    actorPersonId: input.actor.personId, reason: input.reason, metadataJson: input.metadata,
    requestId: input.context?.requestId.slice(0, 100) } });
}
