import type { DemandProvenanceSourceType } from "@/generated/prisma/enums";
import type { PermissionActor } from "@/modules/permissions/types";

export type DirectDemandSourceType = "TOWNSHIP_DIRECT" | "ADMIN_DIRECT";

type DraftIdentity = {
  createdByPersonId: string;
  responsibleAreaId: string;
};

function hasRole(actor: PermissionActor, roles: readonly string[]): boolean {
  return actor.effectiveRoles.some((role) => roles.includes(role));
}

function hasTownshipSource(sourceTypes: readonly DemandProvenanceSourceType[]): boolean {
  return sourceTypes.some((sourceType) => sourceType === "TOWNSHIP_DIRECT" || sourceType === "DEMAND_LEAD");
}

function hasAdminSource(sourceTypes: readonly DemandProvenanceSourceType[]): boolean {
  return sourceTypes.includes("ADMIN_DIRECT");
}

export function canCreateFormalDemandFromSource(
  actor: PermissionActor,
  sourceType: DirectDemandSourceType,
  responsibleAreaId: string,
): boolean {
  if (!actor.capabilities.has("demand.formal.create")) return false;
  if (sourceType === "TOWNSHIP_DIRECT") {
    return hasRole(actor, ["TOWNSHIP_STAFF"])
      && actor.townshipAreaIds.includes(responsibleAreaId);
  }
  return hasRole(actor, ["ADMIN", "SUPER_ADMIN"]) && actor.hasGlobalOperational;
}

export function formalDemandDraftEditSource(
  actor: PermissionActor,
  demand: DraftIdentity,
  sourceTypes: readonly DemandProvenanceSourceType[],
): DirectDemandSourceType | null {
  if (!actor.capabilities.has("demand.formal.create")) return null;
  const adminPath = hasAdminSource(sourceTypes)
    && hasRole(actor, ["ADMIN", "SUPER_ADMIN"])
    && actor.hasGlobalOperational
    && demand.createdByPersonId === actor.personId;
  if (adminPath) return "ADMIN_DIRECT";
  const townshipPath = hasTownshipSource(sourceTypes)
    && hasRole(actor, ["TOWNSHIP_STAFF"])
    && actor.townshipAreaIds.includes(demand.responsibleAreaId);
  return townshipPath ? "TOWNSHIP_DIRECT" : null;
}

export function canSubmitFormalDemandReview(
  actor: PermissionActor,
  demand: Pick<DraftIdentity, "responsibleAreaId">,
  sourceTypes: readonly DemandProvenanceSourceType[],
): boolean {
  if (!actor.capabilities.has("demand.submit_review")) return false;
  const adminPath = hasAdminSource(sourceTypes)
    && hasRole(actor, ["ADMIN", "SUPER_ADMIN"])
    && actor.hasGlobalOperational;
  const townshipPath = hasTownshipSource(sourceTypes)
    && hasRole(actor, ["TOWNSHIP_STAFF"])
    && actor.townshipAreaIds.includes(demand.responsibleAreaId);
  return adminPath || townshipPath;
}
