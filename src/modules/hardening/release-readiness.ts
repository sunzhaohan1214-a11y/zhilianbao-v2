import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { readFile, stat } from "node:fs/promises";
import { isIP } from "node:net";

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
export type ExternalEvidenceCategory = "scanner" | "backup" | "maintenance" | "restore" | "migration" | "uat" | "preflight" | "ai";
type EvidencePointer = { reference?: unknown; sourcePath?: unknown };
type BoundEvidence = { category?: unknown; candidateSha?: unknown; environment?: unknown; status?: unknown; verifiedAt?: unknown; details?: unknown };
const MAX_EVIDENCE_BYTES = 1_048_576;
const EVIDENCE_TIMEOUT_MS = 8_000;

export function isCommitSha(value: string | undefined): value is string {
  return Boolean(value && /^[a-f0-9]{40}$/i.test(value));
}

function immutableDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const urn = /^urn:sha256:([a-f0-9]{64})$/i.exec(value);
  if (urn) return urn[1].toLowerCase();
  try {
    const url = new URL(value);
    const digest = url.protocol === "https:" ? url.searchParams.get("sha256") : null;
    return digest && /^[a-f0-9]{64}$/i.test(digest) ? digest.toLowerCase() : null;
  } catch { return null; }
}

function sanitizedEvidenceRef(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  if (/^urn:sha256:[a-f0-9]{64}$/i.test(value)) return value;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch { return undefined; }
}

function isUnsafeIpv4(value: string): boolean {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
    || (a === 192 && b === 0) || (a === 192 && b === 2) || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0) || a >= 224;
}

function isUnsafeIpAddress(value: string): boolean {
  const normalized = value.replace(/^\[|\]$/g, "").toLowerCase();
  if (isIP(normalized) === 4) return isUnsafeIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  const mappedIpv4 = /(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)?.[1];
  if (mappedIpv4) return isUnsafeIpv4(mappedIpv4);
  const first = Number.parseInt(normalized.split(":")[0] || "0", 16);
  return normalized === "::" || normalized === "::1" || (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00 || normalized.startsWith("2001:db8:");
}

async function assertSafeHttpsReference(reference: string): Promise<URL> {
  let url: URL;
  try { url = new URL(reference); } catch { throw new Error("EVIDENCE_REFERENCE_UNSAFE"); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("EVIDENCE_REFERENCE_UNSAFE");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) throw new Error("EVIDENCE_REFERENCE_UNSAFE");
  if (isIP(hostname)) {
    if (isUnsafeIpAddress(hostname)) throw new Error("EVIDENCE_REFERENCE_UNSAFE");
    return url;
  }
  let addresses: Array<{ address: string; family: number }>;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); } catch { throw new Error("EVIDENCE_REFERENCE_UNREACHABLE"); }
  if (!addresses.length || addresses.some(({ address }) => isUnsafeIpAddress(address))) throw new Error("EVIDENCE_REFERENCE_UNSAFE");
  return url;
}

async function readLimitedResponse(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_EVIDENCE_BYTES) throw new Error("EVIDENCE_REFERENCE_TOO_LARGE");
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_EVIDENCE_BYTES) {
      await reader.cancel();
      throw new Error("EVIDENCE_REFERENCE_TOO_LARGE");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

async function readSourceBytes(sourcePath: string): Promise<Uint8Array> {
  let info;
  try { info = await stat(sourcePath); } catch { throw new Error("EVIDENCE_SOURCE_UNREADABLE"); }
  if (!info.isFile()) throw new Error("EVIDENCE_SOURCE_INVALID");
  if (info.size > MAX_EVIDENCE_BYTES) throw new Error("EVIDENCE_SOURCE_TOO_LARGE");
  try { return await readFile(sourcePath); } catch { throw new Error("EVIDENCE_SOURCE_UNREADABLE"); }
}

async function readReferenceBytes(reference: string): Promise<Uint8Array> {
  const url = await assertSafeHttpsReference(reference);
  let response: Response;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(EVIDENCE_TIMEOUT_MS), redirect: "error" });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    throw new Error(name === "TimeoutError" || name === "AbortError" ? "EVIDENCE_REFERENCE_TIMEOUT" : "EVIDENCE_REFERENCE_UNREACHABLE");
  }
  if (!response.ok) throw new Error("EVIDENCE_REFERENCE_HTTP_ERROR");
  return readLimitedResponse(response);
}

function stableEvidenceError(error: unknown, fallback: string): string {
  return error instanceof Error && /^EVIDENCE_[A-Z0-9_]+$/.test(error.message) ? error.message : fallback;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

async function parseBoundEvidence(raw: string | undefined, candidateSha: string, category: ExternalEvidenceCategory, environment: "TEST" | "PROD", missingStatus: ReadinessStatus): Promise<{ validation: EvidenceValidation; details?: Record<string, unknown> }> {
  if (!raw?.trim()) return { validation: { status: missingStatus, errorCode: "IMMUTABLE_EVIDENCE_MISSING" } };
  let pointer: EvidencePointer;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    pointer = parsed as EvidencePointer;
  } catch { return { validation: { status: "FAIL", errorCode: "IMMUTABLE_EVIDENCE_INVALID" } }; }
  const evidenceRef = sanitizedEvidenceRef(pointer.reference);
  const reference = typeof pointer.reference === "string" ? pointer.reference.trim() : "";
  const sourcePath = typeof pointer.sourcePath === "string" ? pointer.sourcePath.trim() : "";
  let isHttpsReference = false;
  if (reference && !reference.startsWith("urn:sha256:")) {
    let protocol: string;
    try { protocol = new URL(reference).protocol; } catch { protocol = ""; }
    if (protocol !== "https:") return { validation: { status: "FAIL", errorCode: "EVIDENCE_REFERENCE_UNSAFE", evidenceRef } };
    isHttpsReference = true;
  }
  const digest = immutableDigest(pointer.reference);
  if (!digest) return { validation: { status: "FAIL", errorCode: "EVIDENCE_REFERENCE_NOT_IMMUTABLE", evidenceRef } };
  if (!sourcePath && !isHttpsReference) return { validation: { status: "FAIL", errorCode: "EVIDENCE_SOURCE_MISSING", evidenceRef } };
  let sourceBytes: Uint8Array | undefined;
  if (sourcePath) {
    try { sourceBytes = await readSourceBytes(sourcePath); } catch (error) { return { validation: { status: "FAIL", errorCode: stableEvidenceError(error, "EVIDENCE_SOURCE_UNREADABLE"), evidenceRef } }; }
    if (createHash("sha256").update(sourceBytes).digest("hex") !== digest) return { validation: { status: "FAIL", errorCode: "EVIDENCE_SOURCE_DIGEST_MISMATCH", evidenceRef } };
  }
  let referenceBytes: Uint8Array | undefined;
  if (isHttpsReference) {
    try { referenceBytes = await readReferenceBytes(reference); } catch (error) { return { validation: { status: "FAIL", errorCode: stableEvidenceError(error, "EVIDENCE_REFERENCE_UNREACHABLE"), evidenceRef } }; }
    if (createHash("sha256").update(referenceBytes).digest("hex") !== digest) return { validation: { status: "FAIL", errorCode: "EVIDENCE_REFERENCE_DIGEST_MISMATCH", evidenceRef } };
  }
  if (sourceBytes && referenceBytes && !sameBytes(sourceBytes, referenceBytes)) return { validation: { status: "FAIL", errorCode: "EVIDENCE_SOURCE_REFERENCE_MISMATCH", evidenceRef } };
  const bytes = sourceBytes ?? referenceBytes;
  if (!bytes) return { validation: { status: "FAIL", errorCode: "EVIDENCE_SOURCE_MISSING", evidenceRef } };
  let evidence: BoundEvidence;
  try { evidence = JSON.parse(new TextDecoder().decode(bytes)) as BoundEvidence; } catch { return { validation: { status: "FAIL", errorCode: "EVIDENCE_CONTENT_INVALID", evidenceRef } }; }
  if (evidence.category !== category) return { validation: { status: "FAIL", errorCode: "EVIDENCE_CATEGORY_MISMATCH", evidenceRef } };
  if (evidence.candidateSha !== candidateSha) return { validation: { status: "FAIL", errorCode: "EVIDENCE_CANDIDATE_SHA_MISMATCH", evidenceRef } };
  if (evidence.environment !== environment) return { validation: { status: "FAIL", errorCode: "EVIDENCE_ENVIRONMENT_MISMATCH", evidenceRef } };
  if (evidence.status !== "PASS") return { validation: { status: "FAIL", errorCode: "EVIDENCE_STATUS_NOT_PASS", evidenceRef } };
  if (typeof evidence.verifiedAt !== "string" || Number.isNaN(new Date(evidence.verifiedAt).getTime())) return { validation: { status: "FAIL", errorCode: "EVIDENCE_VERIFIED_AT_INVALID", evidenceRef } };
  if (!evidence.details || typeof evidence.details !== "object" || Array.isArray(evidence.details)) return { validation: { status: "FAIL", errorCode: "EVIDENCE_DETAILS_MISSING", evidenceRef } };
  return { validation: { status: "PASS", evidenceRef }, details: evidence.details as Record<string, unknown> };
}

function nonEmpty(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function finiteAtMost(value: unknown, maximum: number): boolean { return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum; }

export async function validateGenericEvidence(raw: string | undefined, candidateSha: string, category: ExternalEvidenceCategory, environment: "TEST" | "PROD", missingStatus: ReadinessStatus = "BLOCKED_BY_EXTERNAL_ENV"): Promise<EvidenceValidation> {
  return (await parseBoundEvidence(raw, candidateSha, category, environment, missingStatus)).validation;
}

export async function validateScannerEvidence(raw: string | undefined, candidateSha: string): Promise<EvidenceValidation> {
  const parsed = await parseBoundEvidence(raw, candidateSha, "scanner", "PROD", "BLOCKED_BY_EXTERNAL_ENV");
  if (parsed.validation.status !== "PASS") return parsed.validation;
  const details = parsed.details!;
  return details.provider === "clamav" && details.health === "READY" && details.cleanAccepted === true && details.eicarRejected === true
    ? parsed.validation
    : { status: "FAIL", errorCode: "SCANNER_EVIDENCE_INCOMPLETE", evidenceRef: parsed.validation.evidenceRef };
}

export async function validateBackupEvidence(raw: string | undefined, candidateSha: string, expected: { region?: string; clusterId?: string; vpcId?: string; subnetId?: string }, now = new Date()): Promise<EvidenceValidation> {
  const parsed = await parseBoundEvidence(raw, candidateSha, "backup", "PROD", "BLOCKED_BY_EXTERNAL_ENV");
  if (parsed.validation.status !== "PASS") return parsed.validation;
  const details = parsed.details!;
  const snapshotAt = typeof details.snapshotAt === "string" ? new Date(details.snapshotAt) : null;
  const fresh = snapshotAt && !Number.isNaN(snapshotAt.getTime()) && snapshotAt.getTime() <= now.getTime() && now.getTime() - snapshotAt.getTime() <= 86_400_000;
  return details.provider === "tencent-cynosdb" && details.health === "READY" && details.backupStatus === "SUCCEEDED" && details.sourceEnvironment === "PROD"
    && details.region === expected.region && details.clusterId === expected.clusterId && details.vpcId === expected.vpcId && details.subnetId === expected.subnetId && fresh
    ? parsed.validation
    : { status: "FAIL", errorCode: "BACKUP_EVIDENCE_IDENTITY_HEALTH_OR_FRESHNESS_INVALID", evidenceRef: parsed.validation.evidenceRef };
}

export async function validateMaintenanceEvidence(raw: string | undefined, candidateSha: string): Promise<EvidenceValidation> {
  const parsed = await parseBoundEvidence(raw, candidateSha, "maintenance", "PROD", "BLOCKED_BY_EXTERNAL_ENV"); if (parsed.validation.status !== "PASS") return parsed.validation; const details = parsed.details!;
  return nonEmpty(details.provider) && details.health === "READY" && details.enterPassed === true && details.exitPassed === true ? parsed.validation : { status: "FAIL", errorCode: "MAINTENANCE_EVIDENCE_INCOMPLETE", evidenceRef: parsed.validation.evidenceRef };
}

export async function validateRestoreEvidence(raw: string | undefined, candidateSha: string): Promise<EvidenceValidation> {
  const parsed = await parseBoundEvidence(raw, candidateSha, "restore", "TEST", "BLOCKED_BY_EXTERNAL_ENV"); if (parsed.validation.status !== "PASS") return parsed.validation; const details = parsed.details!;
  const complete = nonEmpty(details.sourceBackupId) && nonEmpty(details.sourceClusterId) && details.sourceEnvironment === "TEST"
    && nonEmpty(details.targetClusterId) && details.targetEnvironment === "TEST" && details.validationPassed === true
    && finiteAtMost(details.rtoHours, 8) && finiteAtMost(details.rpoHours, 24) && details.cleanupCompleted === true;
  return complete ? parsed.validation : { status: "FAIL", errorCode: "RESTORE_EVIDENCE_INCOMPLETE", evidenceRef: parsed.validation.evidenceRef };
}

export async function validateMigrationEvidence(raw: string | undefined, candidateSha: string): Promise<EvidenceValidation> {
  const parsed = await parseBoundEvidence(raw, candidateSha, "migration", "TEST", "BLOCKED_BY_SOURCE_DATA"); if (parsed.validation.status !== "PASS") return parsed.validation; const details = parsed.details!;
  const complete = nonEmpty(details.sourceSnapshotIdentity) && nonEmpty(details.targetMigrationDatabase) && details.dryRunPassed === true
    && details.applyPassed === true && details.rerunPassed === true && details.reconciliationPassed === true;
  return complete ? parsed.validation : { status: "FAIL", errorCode: "MIGRATION_EVIDENCE_INCOMPLETE", evidenceRef: parsed.validation.evidenceRef };
}

export async function validateUatEvidence(raw: string | undefined, candidateSha: string): Promise<EvidenceValidation> {
  const parsed = await parseBoundEvidence(raw, candidateSha, "uat", "TEST", "BLOCKED_BY_UAT"); if (parsed.validation.status !== "PASS") return parsed.validation; const details = parsed.details!;
  return details.p0Open === 0 && details.p1Open === 0 && details.businessSignoff === true && details.operationsSignoff === true
    ? parsed.validation : { status: "FAIL", errorCode: "UAT_EVIDENCE_INCOMPLETE", evidenceRef: parsed.validation.evidenceRef };
}

export async function validatePreflightEvidence(raw: string | undefined, candidateSha: string): Promise<EvidenceValidation> {
  const parsed = await parseBoundEvidence(raw, candidateSha, "preflight", "PROD", "BLOCKED_BY_EXTERNAL_ENV"); if (parsed.validation.status !== "PASS") return parsed.validation; const details = parsed.details!;
  return details.checksPassed === true && details.rollbackReady === true && details.changeWindowApproved === true
    ? parsed.validation : { status: "FAIL", errorCode: "PREFLIGHT_EVIDENCE_INCOMPLETE", evidenceRef: parsed.validation.evidenceRef };
}

export async function validateAiEvidence(raw: string | undefined, candidateSha: string): Promise<EvidenceValidation> {
  const parsed = await parseBoundEvidence(raw, candidateSha, "ai", "PROD", "BLOCKED_BY_EXTERNAL_ENV"); if (parsed.validation.status !== "PASS") return parsed.validation; const details = parsed.details!;
  return nonEmpty(details.provider) && nonEmpty(details.model) && details.evaluationPassed === true
    ? parsed.validation : { status: "FAIL", errorCode: "AI_EVIDENCE_INCOMPLETE", evidenceRef: parsed.validation.evidenceRef };
}

export function validateGithubProtection(policy: Record<string, unknown> | null): EvidenceValidation {
  if (!policy) return { status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: "GITHUB_PROTECTION_EVIDENCE_UNAVAILABLE" };
  const reviews = policy.required_pull_request_reviews as Record<string, unknown> | null;
  const statusChecks = policy.required_status_checks as Record<string, unknown> | null;
  const contexts = Array.isArray(statusChecks?.contexts) ? statusChecks.contexts.filter((item): item is string => typeof item === "string") : [];
  const checks = Array.isArray(statusChecks?.checks) ? statusChecks.checks.map((item) => typeof item === "object" && item ? (item as { context?: unknown }).context : null).filter((item): item is string => typeof item === "string") : [];
  const required = new Set([...contexts, ...checks]);
  const enabled = (value: unknown) => typeof value === "object" && value !== null && (value as { enabled?: unknown }).enabled === true;
  const explicitlyDisabled = (value: unknown) => typeof value === "object" && value !== null && (value as { enabled?: unknown }).enabled === false;
  const complete = Boolean(reviews)
    && Number(reviews?.required_approving_review_count ?? 0) >= 1
    && reviews?.dismiss_stale_reviews === true
    && REQUIRED_CI_JOBS.every((job) => required.has(job))
    && enabled(policy.required_conversation_resolution)
    && enabled(policy.enforce_admins)
    && explicitlyDisabled(policy.allow_force_pushes);
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
  const environmentKnown = ["LOCAL", "TEST", "PROD"].includes(input.appEnvironment);
  const environmentMatchesMode = input.mode !== "prod" || input.appEnvironment === "PROD";
  const environmentValid = environmentKnown && environmentMatchesMode;
  const environmentError = input.mode === "prod" && input.appEnvironment !== "PROD" ? "PRODUCTION_APP_ENV_REQUIRED" : "APP_ENV_UNKNOWN";
  const shaValid = isCommitSha(input.appVersion);
  const gates: ReadinessGate[] = [
    { code: "PRODUCTION_EVALUATION_MODE", category: "production", status: input.mode === "prod" ? "PASS" : "BLOCKED_BY_EXTERNAL_ENV", requiredForProduction: true, codeReachable: false, errorCode: input.mode === "prod" ? undefined : "PRODUCTION_EVALUATION_NOT_REQUESTED" },
    { code: "APP_ENV_VALID", category: "code", status: environmentValid ? "PASS" : "FAIL", requiredForProduction: true, codeReachable: true, errorCode: environmentValid ? undefined : environmentError },
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
