import type { Prisma } from "@/generated/prisma/client";
import type { AuthRequestContext } from "@/modules/identity/request-context";
import type { PermissionActor } from "@/modules/permissions/types";

export type TripMutationContext = Pick<AuthRequestContext, "requestId" | "ip" | "deviceName">;

export async function writeTripAudit(tx: Prisma.TransactionClient, input: {
  actor: PermissionActor;
  actionCode: string;
  entityType: "TRIP" | "TRIP_RESULT" | "TRIP_PARTICIPANT" | "ENTERPRISE_VISIT" | "VISIT_SUPPLEMENT";
  entityId: string;
  before?: Prisma.InputJsonObject;
  after?: Prisma.InputJsonObject;
  reason?: string;
  context?: TripMutationContext;
}) {
  await tx.auditLog.create({ data: {
    actorPersonId: input.actor.personId,
    actorAccountId: input.actor.accountId,
    actionCode: input.actionCode.slice(0, 100),
    entityType: input.entityType,
    entityId: input.entityId,
    beforeJson: input.before,
    afterJson: input.after,
    reason: input.reason?.slice(0, 500),
    requestId: input.context?.requestId?.slice(0, 100),
    ip: input.context?.ip?.slice(0, 45),
    device: input.context?.deviceName?.slice(0, 255),
  } });
}

export async function writeTripTransition(tx: Prisma.TransactionClient, input: {
  actor: PermissionActor;
  entityId: string;
  fromState?: string;
  toState: string;
  actionCode: string;
  reason?: string;
  metadata?: Prisma.InputJsonObject;
  context?: TripMutationContext;
}) {
  await tx.stateTransitionHistory.create({ data: {
    entityType: "TRIP",
    entityId: input.entityId,
    fromState: input.fromState,
    toState: input.toState,
    actionCode: input.actionCode.slice(0, 100),
    actorPersonId: input.actor.personId,
    reason: input.reason?.slice(0, 500),
    metadataJson: input.metadata,
    requestId: input.context?.requestId?.slice(0, 100),
  } });
}
