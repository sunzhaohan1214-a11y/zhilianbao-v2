import type { Prisma } from "@/generated/prisma/client";
import type { AuthRequestContext } from "@/modules/identity/request-context";
import type { PermissionActor } from "@/modules/permissions/types";

type Context = Pick<AuthRequestContext, "requestId" | "ip" | "deviceName">;

export async function writePolicyAudit(tx: Prisma.TransactionClient, input: {
  actor: PermissionActor; actionCode: string; entityType: "POLICY" | "POLICY_CONTENT_VERSION" | "POLICY_AI_INTERPRETATION" | "POLICY_REPLACEMENT";
  entityId: string; before?: Prisma.InputJsonObject; after?: Prisma.InputJsonObject; reason?: string; context?: Context;
}) {
  await tx.auditLog.create({ data: {
    actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: input.actionCode,
    entityType: input.entityType, entityId: input.entityId, beforeJson: input.before, afterJson: input.after,
    reason: input.reason, requestId: input.context?.requestId?.slice(0, 100), ip: input.context?.ip?.slice(0, 45), device: input.context?.deviceName?.slice(0, 255),
  } });
}

export async function writePolicyTransition(tx: Prisma.TransactionClient, input: {
  actor: PermissionActor; entityId: string; fromState?: string; toState: string; actionCode: string; reason?: string; metadata?: Prisma.InputJsonObject; context?: Context;
}) {
  await tx.stateTransitionHistory.create({ data: {
    entityType: "POLICY", entityId: input.entityId, fromState: input.fromState, toState: input.toState,
    actionCode: input.actionCode, actorPersonId: input.actor.personId, reason: input.reason,
    metadataJson: input.metadata, requestId: input.context?.requestId?.slice(0, 100),
  } });
}
