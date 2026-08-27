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
  };
}
