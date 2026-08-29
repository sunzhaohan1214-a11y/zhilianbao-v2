export const READINESS_STATUSES = [
  "PASS", "FAIL", "BLOCKED_BY_EXTERNAL_ENV", "BLOCKED_BY_SOURCE_DATA", "BLOCKED_BY_UAT", "NOT_APPLICABLE",
] as const;
export type ReadinessStatus = typeof READINESS_STATUSES[number];
export type ReadinessCategory = "code" | "ci" | "security" | "performance" | "browser" | "weakNetwork" | "attachments" | "ai" | "backup" | "restore" | "migration" | "github" | "uat" | "production";
export type ReadinessGate = {
  code: string;
  category: ReadinessCategory;
  status: ReadinessStatus;
  requiredForProduction: boolean;
  codeReachable: boolean;
  configured?: boolean;
  provider?: string;
  version?: string;
  candidateSha?: string;
  evidenceRef?: string;
  errorCode?: string;
};

export type ReleaseReadinessReport = {
  version: "m3-008-v2";
  mode: "local" | "ci" | "prod";
  timestamp: string;
  overall: ReadinessStatus;
  releaseReady: boolean;
  gates: ReadinessGate[];
};

export const REQUIRED_CI_JOBS = ["quality", "database", "critical-e2e", "docker-build", "security", "performance", "browser-compat"] as const;
export type EvidenceValidation = { status: ReadinessStatus; errorCode?: string; evidenceRef?: string };
type BoundEvidence = { reference?: unknown; candidateSha?: unknown; status?: unknown; verifiedAt?: unknown; details?: unknown };

export function isCommitSha(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{40}$/i.test(value));
}

function isImmutableReference(value: unknown): value is string {
  return typeof value === "string" && (/^urn:sha256:[a-f0-9]{64}$/i.test(value) || /^https:\/\/\S+[?#&]sha256=[a-f0-9]{64}(?:&\S*)?$/i.test(value));
}

function parseBoundEvidence(raw: string | undefined, candidateSha: string, missingStatus: ReadinessStatus): { validation: EvidenceValidation; details?: Record<string, unknown> } {
  if (!raw?.trim()) return { validation: { status: missingStatus, errorCode: "IMMUTABLE_EVIDENCE_MISSING" } };
  let evidence: BoundEvidence;
  try { evidence = JSON.parse(raw) as BoundEvidence; } catch { return { validation: { status: "FAIL", errorCode: "IMMUTABLE_EVIDENCE_INVALID" } }; }
  if (!isImmutableReference(evidence.reference)) return { validation: { status: "FAIL", errorCode: "EVIDENCE_REFERENCE_NOT_IMMUTABLE" } };
  if (evidence.candidateSha !== candidateSha) return { validation: { status: "FAIL", errorCode: "EVIDENCE_CANDIDATE_SHA_MISMATCH", evidenceRef: evidence.reference } };
  if (evidence.status !== "PASS") return { validation: { status: "FAIL", errorCode: "EVIDENCE_STATUS_NOT_PASS", evidenceRef: evidence.reference } };
  if (typeof evidence.verifiedAt !== "string" || Number.isNaN(new Date(evidence.verifiedAt).getTime())) return { validation: { status: "FAIL", errorCode: "EVIDENCE_VERIFIED_AT_INVALID", evidenceRef: evidence.reference } };
  if (!evidence.details || typeof evidence.details !== "object" || Array.isArray(evidence.details)) return { validation: { status: "FAIL", errorCode: "EVIDENCE_DETAILS_MISSING", evidenceRef: evidence.reference } };
  return { validation: { status: "PASS", evidenceRef: evidence.reference }, details: evidence.details as Record<string, unknown> };
}

export function validateGenericEvidence(raw: string | undefined, candidateSha: string, missingStatus: ReadinessStatus = "BLOCKED_BY_EXTERNAL_ENV"): EvidenceValidation {
  return parseBoundEvidence(raw, candidateSha, missingStatus).validation;
}

export function validateScannerEvidence(raw: string | undefined, candidateSha: string): EvidenceValidation {
  const parsed = parseBoundEvidence(raw, candidateSha, "BLOCKED_BY_EXTERNAL_ENV");
  if (parsed.validation.status !== "PASS") return parsed.validation;
  const details = parsed.details!;
  return details.provider === "clamav" && details.health === "READY" && details.cleanAccepted === true && details.eicarRejected === true
    ? parsed.validation
    : { status: "FAIL", errorCode: "SCANNER_EVIDENCE_INCOMPLETE", evidenceRef: parsed.validation.evidenceRef };
}

export function validateBackupEvidence(raw: string | undefined, candidateSha: string, expected: { region?: string; clusterId?: string }, now = new Date()): EvidenceValidation {
  const parsed = parseBoundEvidence(raw, candidateSha, "BLOCKED_BY_EXTERNAL_ENV");
  if (parsed.validation.status !== "PASS") return parsed.validation;
  const details = parsed.details!;
  const snapshotAt = typeof details.snapshotAt === "string" ? new Date(details.snapshotAt) : null;
  const fresh = snapshotAt && !Number.isNaN(snapshotAt.getTime()) && snapshotAt.getTime() <= now.getTime() && now.getTime() - snapshotAt.getTime() <= 86_400_000;
  return details.provider === "tencent-cynosdb" && details.health === "READY" && details.backupStatus === "SUCCEEDED"
    && details.region === expected.region && details.clusterId === expected.clusterId && fresh
    ? parsed.validation
    : { status: "FAIL", errorCode: "BACKUP_EVIDENCE_IDENTITY_HEALTH_OR_FRESHNESS_INVALID", evidenceRef: parsed.validation.evidenceRef };
}

export function validateGithubProtection(policy: Record<string, unknown> | null): EvidenceValidation {
  if (!policy) return { status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: "GITHUB_PROTECTION_EVIDENCE_UNAVAILABLE" };
  const reviews = policy.required_pull_request_reviews as Record<string, unknown> | null;
  const statusChecks = policy.required_status_checks as Record<string, unknown> | null;
  const contexts = Array.isArray(statusChecks?.contexts) ? statusChecks.contexts.filter((item): item is string => typeof item === "string") : [];
  const checks = Array.isArray(statusChecks?.checks) ? statusChecks.checks.map((item) => typeof item === "object" && item ? (item as { context?: unknown }).context : null).filter((item): item is string => typeof item === "string") : [];
  const required = new Set([...contexts, ...checks]);
  const enabled = (value: unknown) => typeof value === "object" && value !== null && (value as { enabled?: unknown }).enabled === true;
  const complete = Boolean(reviews)
    && Number(reviews?.required_approving_review_count ?? 0) >= 1
    && reviews?.dismiss_stale_reviews === true
    && REQUIRED_CI_JOBS.every((job) => required.has(job))
    && enabled(policy.required_conversation_resolution)
    && enabled(policy.enforce_admins)
    && !enabled(policy.allow_force_pushes);
  return complete ? { status: "PASS" } : { status: "FAIL", errorCode: "GITHUB_REQUIRED_POLICY_INCOMPLETE" };
}

export function validateExactHeadCi(run: Record<string, unknown> | null, jobs: Array<Record<string, unknown>>, candidateSha: string): EvidenceValidation {
  if (!run) return { status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: "EXACT_HEAD_CI_EVIDENCE_UNAVAILABLE" };
  const evidenceRef = typeof run.html_url === "string" ? run.html_url : undefined;
  if (run.head_sha !== candidateSha) return { status: "FAIL", errorCode: "CI_CANDIDATE_SHA_MISMATCH", evidenceRef };
  if (run.status !== "completed" || run.conclusion !== "success") return { status: "FAIL", errorCode: "CI_RUN_NOT_SUCCESSFUL", evidenceRef };
  const successful = new Set(jobs.filter((job) => job.status === "completed" && job.conclusion === "success" && typeof job.name === "string").map((job) => job.name as string));
  return REQUIRED_CI_JOBS.every((job) => successful.has(job))
    ? { status: "PASS", evidenceRef }
    : { status: "FAIL", errorCode: "CI_REQUIRED_JOBS_INCOMPLETE", evidenceRef };
}

export type ReleaseGateInputs = {
  mode: "local" | "ci" | "prod";
  appEnvironment: string;
  appVersion: string;
  fakeProvidersEnabled: boolean;
  scannerConfigured: boolean;
  backupConfigured: boolean;
  scannerEvidence: EvidenceValidation;
  backupEvidence: EvidenceValidation;
  maintenanceEvidence: EvidenceValidation;
  restoreEvidence: EvidenceValidation;
  migrationEvidence: EvidenceValidation;
  githubProtection: EvidenceValidation;
  exactHeadCi: EvidenceValidation;
  uatEvidence: EvidenceValidation;
  preflightEvidence: EvidenceValidation;
  realAiEvidence?: EvidenceValidation;
};

function evidenceGate(code: string, category: ReadinessCategory, result: EvidenceValidation, blockedStatus?: ReadinessStatus): ReadinessGate {
  return { code, category, status: result.status === "BLOCKED_BY_EXTERNAL_ENV" && blockedStatus ? blockedStatus : result.status, requiredForProduction: true, codeReachable: false, errorCode: result.errorCode, evidenceRef: result.evidenceRef };
}

export function buildReleaseReadiness(input: ReleaseGateInputs, timestamp = new Date().toISOString()): ReleaseReadinessReport {
  const envValid = ["LOCAL", "TEST", "PROD"].includes(input.appEnvironment);
  const shaValid = isCommitSha(input.appVersion);
  const gates: ReadinessGate[] = [
    { code: "PRODUCTION_EVALUATION_MODE", category: "production", status: input.mode === "prod" ? "PASS" : "BLOCKED_BY_EXTERNAL_ENV", requiredForProduction: true, codeReachable: false, errorCode: input.mode === "prod" ? undefined : "PRODUCTION_EVALUATION_NOT_REQUESTED" },
    { code: "APP_ENV_VALID", category: "code", status: envValid ? "PASS" : "FAIL", requiredForProduction: true, codeReachable: true, errorCode: envValid ? undefined : "APP_ENV_UNKNOWN" },
    { code: "APP_VERSION_CANDIDATE_SHA", category: "code", status: shaValid ? "PASS" : input.mode === "prod" ? "FAIL" : "BLOCKED_BY_EXTERNAL_ENV", requiredForProduction: true, codeReachable: input.mode === "prod", version: input.appVersion, candidateSha: shaValid ? input.appVersion : undefined, errorCode: shaValid ? undefined : "APP_VERSION_NOT_COMMIT_SHA" },
    { code: "FAKE_PROVIDERS_DISABLED_IN_PROD", category: "security", status: input.mode === "prod" && input.fakeProvidersEnabled ? "FAIL" : "PASS", requiredForProduction: true, codeReachable: true, errorCode: input.mode === "prod" && input.fakeProvidersEnabled ? "PRODUCTION_FAKE_PROVIDER_ENABLED" : undefined },
    { code: "SECURITY_HARNESS_AVAILABLE", category: "security", status: "PASS", requiredForProduction: false, codeReachable: true, version: "m3-008-v2" },
    { code: "PERFORMANCE_HARNESS_AVAILABLE", category: "performance", status: "PASS", requiredForProduction: false, codeReachable: true, version: "m3-008-v2" },
    { code: "BROWSER_COMPAT_HARNESS_AVAILABLE", category: "browser", status: "PASS", requiredForProduction: false, codeReachable: true, version: "m3-008-v2" },
    { code: "WEAK_NETWORK_HARNESS_AVAILABLE", category: "weakNetwork", status: "PASS", requiredForProduction: false, codeReachable: true, version: "m3-008-v2" },
    { code: "AI_CONTRACT_HARNESS_AVAILABLE", category: "ai", status: "PASS", requiredForProduction: false, codeReachable: true, version: "m3-008-v2" },
    { code: "FILE_SCANNER_CONFIGURED", category: "attachments", status: input.scannerConfigured ? "PASS" : "BLOCKED_BY_EXTERNAL_ENV", requiredForProduction: true, codeReachable: false, configured: input.scannerConfigured, provider: input.scannerConfigured ? "clamav" : "unavailable", errorCode: input.scannerConfigured ? undefined : "FILE_SCANNER_NOT_CONFIGURED" },
    evidenceGate("FILE_SCANNER_PRODUCTION_EVIDENCE", "attachments", input.scannerEvidence),
    { code: "CLOUD_BACKUP_CONFIGURED", category: "backup", status: input.backupConfigured ? "PASS" : "BLOCKED_BY_EXTERNAL_ENV", requiredForProduction: true, codeReachable: false, configured: input.backupConfigured, provider: input.backupConfigured ? "tencent-cynosdb" : "unavailable", errorCode: input.backupConfigured ? undefined : "BACKUP_PROVIDER_NOT_CONFIGURED" },
    evidenceGate("REAL_CLOUD_BACKUP_EVIDENCE", "backup", input.backupEvidence),
    evidenceGate("REAL_MAINTENANCE_PROVIDER_EVIDENCE", "restore", input.maintenanceEvidence),
    evidenceGate("REAL_RESTORE_DRILL_EVIDENCE", "restore", input.restoreEvidence),
    evidenceGate("FULL_V1_REHEARSAL_EVIDENCE", "migration", input.migrationEvidence, "BLOCKED_BY_SOURCE_DATA"),
    evidenceGate("GITHUB_MAIN_PROTECTION", "github", input.githubProtection),
    evidenceGate("EXACT_HEAD_SEVEN_JOB_CI", "ci", input.exactHeadCi),
    evidenceGate("UAT_SIGNOFF_EVIDENCE", "uat", input.uatEvidence, "BLOCKED_BY_UAT"),
    evidenceGate("PROD_PREFLIGHT_EVIDENCE", "production", input.preflightEvidence),
    { code: "REAL_AI_PROVIDER_EVAL", category: "ai", status: input.realAiEvidence?.status ?? "BLOCKED_BY_EXTERNAL_ENV", requiredForProduction: false, codeReachable: false, errorCode: input.realAiEvidence?.errorCode ?? "REAL_AI_EVAL_NOT_EXECUTED", evidenceRef: input.realAiEvidence?.evidenceRef },
  ];
  return summarizeReadiness({ version: "m3-008-v2", mode: input.mode, timestamp, gates });
}

export function summarizeReadiness(input: Omit<ReleaseReadinessReport, "overall" | "releaseReady">): ReleaseReadinessReport {
  const productionBlocker = input.gates.some((gate) => gate.requiredForProduction && gate.status !== "PASS" && gate.status !== "NOT_APPLICABLE");
  const codeFailure = input.gates.some((gate) => gate.codeReachable && gate.status === "FAIL");
  const status: ReadinessStatus = codeFailure || input.gates.some((gate) => gate.status === "FAIL")
    ? "FAIL"
    : productionBlocker
      ? input.gates.find((gate) => gate.requiredForProduction && gate.status.startsWith("BLOCKED_"))?.status ?? "FAIL"
      : "PASS";
  return { ...input, overall: status, releaseReady: !productionBlocker };
}

export function readinessExitCode(report: ReleaseReadinessReport): number {
  if (report.mode === "prod") return report.releaseReady ? 0 : 1;
  return report.gates.some((gate) => gate.codeReachable && gate.status === "FAIL") ? 1 : 0;
}
