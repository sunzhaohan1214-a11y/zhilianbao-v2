import type { AccountStatus, RoleCode } from "@/generated/prisma/client";
import type { Capability } from "./capability-registry";

export const DATA_SCOPES = [
  "SELF",
  "GLOBAL_PUBLISHED",
  "TOWNSHIP",
  "DEPARTMENT_TOWNSHIPS",
  "GLOBAL_OPERATIONAL",
  "REIMBURSEMENT_AUTHORIZED",
  "SYSTEM",
  "LEADER_SCOPE",
] as const;

export type DataScope = (typeof DATA_SCOPES)[number];

export type PermissionActor = {
  personId: string;
  accountId: string;
  accountStatus: AccountStatus;
  permissionVersion: bigint;
  effectiveRoles: RoleCode[];
  capabilities: Set<Capability>;
  specialPermissions: Set<string>;
  selfPersonId: string;
  townshipAreaIds: string[];
  departmentAreaIds: string[];
  hasGlobalPublished: boolean;
  hasGlobalOperational: boolean;
  hasSystem: boolean;
  currentBatchId?: string;
  currentBatchMember: boolean;
  configurationIssues: string[];
};
export type ResourceScopeInput = {
  resourceType: string;
  requiredScope: DataScope;
  areaId?: string;
  ownerPersonId?: string;
};

export type AuthorizationPolicy =
  | boolean
  | ((actor: PermissionActor) => boolean | Promise<boolean>);

export type AuthorizationResult = {
  allowed: true;
  actor: PermissionActor;
};
