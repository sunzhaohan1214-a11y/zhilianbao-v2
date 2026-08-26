import type { AuthorizationPolicy } from "./types";

export interface DemandRelationPolicy {
  canAccess: AuthorizationPolicy;
}
export interface ReimbursementRelationPolicy {
  canAccess: AuthorizationPolicy;
}

export interface HelpRelationPolicy {
  canAccess: AuthorizationPolicy;
}

export interface TalentRoundRelationPolicy {
  canAccess: AuthorizationPolicy;
}

export interface BusinessStatePolicy {
  allows: AuthorizationPolicy;
}
