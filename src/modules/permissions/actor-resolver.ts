import type { RoleCode } from "@/generated/prisma/client";
import type { CurrentSession } from "@/modules/identity/session-service";
import { dateRangeContains } from "./effective";
import { PermissionError } from "./permission-errors";
import { loadPermissionGraph } from "./repository/permission-repository";
import { resolveCapabilities } from "./role-capabilities";
import type { PermissionActor } from "./types";

export async function resolvePermissionActor(
  session: CurrentSession,
  now = new Date(),
): Promise<PermissionActor> {
  const graph = await loadPermissionGraph(session.accountId, now);
  if (!graph) throw new PermissionError("UNAUTHENTICATED", "登录状态已失效");
  const { account } = graph;
  if (
    account.personId !== session.personId
    || account.status !== "NORMAL"
    || account.forcePasswordChange
    || !account.confidentialityConfirmedAt
    || account.permissionVersion !== session.permissionVersion
  ) {
    throw new PermissionError("UNAUTHENTICATED", "登录状态或权限版本已失效");
  }

  const assigned = new Set(graph.roleAssignments.map(({ roleCode }) => roleCode));
  const configurationIssues: string[] = [];
  const currentBatch = graph.currentBatches.length === 1 ? graph.currentBatches[0] : undefined;
  if (graph.currentBatches.length !== 1) configurationIssues.push("CURRENT_BATCH_COUNT_INVALID");

  const currentMembership = currentBatch
    ? graph.memberships.find((membership) =>
        membership.batchId === currentBatch.id
        && membership.status === "ACTIVE"
        && dateRangeContains(membership.startDate, membership.endDate, now))
    : undefined;
  const currentBatchMember = Boolean(currentMembership);
  const effectiveRoles = new Set<RoleCode>();

  if (assigned.has("MEMBER_CURRENT") && currentBatchMember) effectiveRoles.add("MEMBER_CURRENT");
  if (assigned.has("MEMBER_ALUMNI_PLATFORM") && graph.memberships.length > 0) {
    effectiveRoles.add("MEMBER_ALUMNI_PLATFORM");
  }

  const townshipAppointments = graph.appointments.filter(
    ({ organization }) => organization.type === "TOWNSHIP_ORG",
  );
  const departmentAppointments = graph.appointments.filter(
    ({ organization }) => organization.type === "DEPARTMENT",
  );
  const townshipAreaIds = [...new Set(townshipAppointments.flatMap(
    ({ organization }) => organization.areaMappings.map(({ areaId }) => areaId),
  ))];
  const departmentAreaIds = [...new Set(departmentAppointments.flatMap(
    ({ organization }) => organization.departmentAreaRelations.map(({ areaId }) => areaId),
  ))];

  if (assigned.has("TOWNSHIP_STAFF") && townshipAppointments.length > 0 && townshipAreaIds.length > 0) {
    effectiveRoles.add("TOWNSHIP_STAFF");
  }
  if (assigned.has("DEPARTMENT_STAFF") && departmentAppointments.length > 0 && departmentAreaIds.length > 0) {
    effectiveRoles.add("DEPARTMENT_STAFF");
  }

  const validGroupLeader = Boolean(
    assigned.has("GROUP_LEADER")
    && currentBatchMember
    && currentBatch
    && graph.groupLeaderAssignments.some(({ batchId }) => batchId === currentBatch.id),
  );
  if (validGroupLeader) effectiveRoles.add("GROUP_LEADER");

  for (const role of ["MINISTER", "ADMIN", "SUPER_ADMIN", "LEADER_STAGE2"] as const) {
    if (assigned.has(role)) effectiveRoles.add(role);
  }

  const specialPermissions = new Set(graph.specialGrants.map(({ permissionCode }) => permissionCode));
  if (effectiveRoles.has("MEMBER_CURRENT")) specialPermissions.add("reimbursement.apply");
  if (effectiveRoles.has("SUPER_ADMIN")) {
    specialPermissions.add("reimbursement.manage");
    specialPermissions.add("ai.service_manage");
  }
  const roles = [...effectiveRoles];
  return {
    personId: account.personId,
    accountId: account.id,
    accountStatus: account.status,
    permissionVersion: account.permissionVersion,
    effectiveRoles: roles,
    capabilities: resolveCapabilities(roles, specialPermissions),
    specialPermissions,
    selfPersonId: account.personId,
    townshipAreaIds,
    departmentAreaIds,
    hasGlobalPublished: true,
    hasGlobalOperational: effectiveRoles.has("ADMIN") || effectiveRoles.has("SUPER_ADMIN"),
    hasSystem: effectiveRoles.has("SUPER_ADMIN"),
    currentBatchId: currentBatch?.id,
    currentBatchMember,
    configurationIssues,
  };
}
