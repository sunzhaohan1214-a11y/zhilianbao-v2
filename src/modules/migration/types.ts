import type { EntityMatchResult } from "@/modules/entity-matching";

export const LEGACY_ENTITY_TYPES = [
  "ORGANIZATION", "PERSON", "ENTERPRISE", "TALENT", "POLICY", "DEMAND",
  "PRESENCE", "TRIP", "VISIT", "REIMBURSEMENT", "HELP", "ANNOUNCEMENT", "ROLE",
] as const;

export type LegacyEntityType = typeof LEGACY_ENTITY_TYPES[number];

export type LegacyRecord = {
  sourceId: string;
  entityType: LegacyEntityType;
  payload: Record<string, unknown>;
};

export type MigrationPreviewIssue = {
  sourceEntity: LegacyEntityType | "ATTACHMENT" | "SNAPSHOT";
  sourceId: string;
  code: string;
  severity: "WARNING" | "REVIEW" | "BLOCKER";
  field?: string;
  message: string;
  candidates?: string[];
  sourceSnapshot?: Record<string, unknown>;
};

export type MigrationRecordOutcome = {
  classification: "SUCCESS" | "FAILED" | "SKIPPED" | "MERGED" | "REVIEW";
  targetEntity?: string;
  targetId?: string;
  immutableHistory?: boolean;
  match?: EntityMatchResult;
  issues: MigrationPreviewIssue[];
};

export type ReconciliationModule = {
  module: LegacyEntityType | "ATTACHMENT";
  sourceCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  mergedCount: number;
  reviewCount: number;
  attachmentCount: number;
  attachmentSuccessCount: number;
  attachmentIssueCount: number;
};

export type MigrationReconciliation = {
  sourceSystem: string;
  snapshotId: string;
  schemaVersion: string;
  snapshotAt: string;
  mode: "SAMPLE_REHEARSAL" | "FULL_REHEARSAL";
  dryRun: boolean;
  modules: ReconciliationModule[];
  totals: Omit<ReconciliationModule, "module">;
  unresolvedBlockerCount: number;
  formulaPass: boolean;
  fullRehearsalStatus: "NOT_REQUESTED" | "COMPLETED" | "FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT";
};

export type MigrationResolution = {
  sourceEntity: LegacyEntityType;
  sourceId: string;
  action: "LINK" | "CREATE" | "SKIP" | "WAIVE";
  targetEntity?: string;
  targetId?: string;
  reason: string;
  operator: string;
};
