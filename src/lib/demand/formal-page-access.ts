import type { PermissionActor } from "@/modules/permissions/types";
import type { FormalDemandService } from "@/modules/demand";

type Detail = Awaited<ReturnType<FormalDemandService["detail"]>>;

export function formalDemandPageAccess(actor: PermissionActor, demand: Detail) {
  const admin = actor.effectiveRoles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN");
  const adminDirect = demand.provenances.some(({ sourceType }) => sourceType === "ADMIN_DIRECT");
  const editable = demand.status === "DRAFT" || demand.status === "RETURNED";
  const townshipOwned = actor.townshipAreaIds.includes(demand.responsibleAreaId);
  return {
    canEdit: editable && actor.capabilities.has("demand.formal.create") && (admin
      ? adminDirect && demand.createdByPersonId === actor.personId
      : townshipOwned),
    canSubmit: editable && actor.capabilities.has("demand.submit_review") && (admin ? adminDirect : townshipOwned),
    canReview: demand.status === "PENDING_REVIEW" && actor.capabilities.has("demand.review") && actor.hasGlobalOperational,
    canDirectPublish: demand.status === "DRAFT" && adminDirect && actor.capabilities.has("demand.publish_direct") && actor.hasGlobalOperational,
  };
}
