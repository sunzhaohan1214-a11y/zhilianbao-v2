import type { PermissionActor } from "./types";

export function canShowAdminMenu(actor: PermissionActor): boolean {
  return actor.capabilities.has("admin.shell.access");
}
export function canShowMobileWorkbench(actor: PermissionActor): boolean {
  return actor.effectiveRoles.some((role) => [
    "GROUP_LEADER",
    "MINISTER",
    "TOWNSHIP_STAFF",
    "DEPARTMENT_STAFF",
    "ADMIN",
    "SUPER_ADMIN",
  ].includes(role));
}
