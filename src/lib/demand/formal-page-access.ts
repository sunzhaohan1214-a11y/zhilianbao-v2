import type { PermissionActor } from "@/modules/permissions/types";
import {
  canSubmitFormalDemandReview,
  formalDemandDraftEditSource,
  type FormalDemandService,
} from "@/modules/demand";

type Detail = Awaited<ReturnType<FormalDemandService["detail"]>>;

export function formalDemandPageAccess(actor: PermissionActor, demand: Detail) {
  const adminDirect = demand.provenances.some(({ sourceType }) => sourceType === "ADMIN_DIRECT");
  const sourceTypes = demand.provenances.map(({ sourceType }) => sourceType);
  const editable = demand.status === "DRAFT" || demand.status === "RETURNED";
  return {
    canEdit: editable && formalDemandDraftEditSource(actor, demand, sourceTypes) !== null,
    canSubmit: editable && canSubmitFormalDemandReview(actor, demand, sourceTypes),
    canReview: demand.status === "PENDING_REVIEW" && actor.capabilities.has("demand.review") && actor.hasGlobalOperational,
    canDirectPublish: demand.status === "DRAFT" && adminDirect && actor.capabilities.has("demand.publish_direct") && actor.hasGlobalOperational,
    canClaim: demand.status === "PENDING_CLAIM" && actor.capabilities.has("demand.claim") && actor.currentBatchMember,
    canApplyCollaboration: demand.status === "IN_PROGRESS" && demand.myRelation === "NONE" && actor.capabilities.has("demand.collaboration.apply") && actor.currentBatchMember,
    canManageCollaboration: demand.status === "IN_PROGRESS" && demand.myRelation === "OWNER" && actor.capabilities.has("demand.collaboration.manage"),
    canAcceptInvitation: demand.status === "IN_PROGRESS" && demand.myRelation === "INVITED_PENDING" && actor.capabilities.has("demand.collaboration.apply") && actor.currentBatchMember,
    canLeaveCollaboration: demand.status === "IN_PROGRESS" && demand.myRelation === "COLLABORATOR" && actor.capabilities.has("demand.collaboration.apply"),
  };
}
