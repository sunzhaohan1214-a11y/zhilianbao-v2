import { PermissionError } from "./permission-errors";
import type { PermissionActor, ResourceScopeInput } from "./types";

export function requireResourceScope(actor: PermissionActor, resource: ResourceScopeInput): void {
  let allowed = false;
  switch (resource.requiredScope) {
    case "SELF":
      allowed = Boolean(resource.ownerPersonId) && resource.ownerPersonId === actor.personId;
      break;
    case "GLOBAL_PUBLISHED":
      allowed = actor.hasGlobalPublished;
      break;
    case "TOWNSHIP":
      allowed = resource.areaId !== undefined && actor.townshipAreaIds.includes(resource.areaId);
      break;
    case "DEPARTMENT_TOWNSHIPS":
      allowed = resource.areaId !== undefined && actor.departmentAreaIds.includes(resource.areaId);
      break;
    case "GLOBAL_OPERATIONAL":
      allowed = actor.hasGlobalOperational;
      break;
    case "REIMBURSEMENT_AUTHORIZED":
      allowed = actor.specialPermissions.has("reimbursement.manage") || actor.hasSystem;
      break;
    case "SYSTEM":
      allowed = actor.hasSystem;
      break;
    case "LEADER_SCOPE":
      allowed = actor.effectiveRoles.includes("LEADER_STAGE2");
      break;
  }
  if (!allowed) {
    throw new PermissionError("FORBIDDEN_SCOPE", "当前资源不在账号的数据范围内", {
      resourceType: resource.resourceType,
      requiredScope: resource.requiredScope,
    });
  }
}
