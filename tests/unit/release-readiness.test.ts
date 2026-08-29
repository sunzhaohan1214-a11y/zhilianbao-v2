import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  REQUIRED_CI_JOBS, buildReleaseReadiness, readinessExitCode, validateAiEvidence, validateBackupEvidence,
  validateExactHeadCi, validateGenericEvidence, validateGithubProtection, validateMaintenanceEvidence,
  validateMigrationEvidence, validatePreflightEvidence, validateRestoreEvidence, validateScannerEvidence,
  validateUatEvidence, type EvidenceValidation, type ExternalEvidenceCategory, type ReleaseGateInputs,
} from "@/modules/hardening/release-readiness";

const candidateSha = "1".repeat(40);
const verifiedAt = "2026-08-29T00:00:00.000Z";
const temporaryDirectories: string[] = [];

async function evidence(category: ExternalEvidenceCategory, environment: "TEST" | "PROD", details: Record<string, unknown> = {}, overrides: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "zlb-evidence-")); temporaryDirectories.push(directory);
  const sourcePath = join(directory, `${category}.json`);
  const content = JSON.stringify({ category, candidateSha, environment, status: "PASS", verifiedAt, details, ...overrides });
  await writeFile(sourcePath, content);
  const digest = createHash("sha256").update(content).digest("hex");
  return JSON.stringify({ reference: `urn:sha256:${digest}`, sourcePath });
}

const blocked = (): EvidenceValidation => ({ status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: "TEST_EVIDENCE_MISSING" });
function completeProtection() { return { required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true }, required_status_checks: { contexts: [...REQUIRED_CI_JOBS] }, required_conversation_resolution: { enabled: true }, enforce_admins: { enabled: true }, allow_force_pushes: { enabled: false } }; }
function successfulCi(sha = candidateSha) { return validateExactHeadCi({ head_sha: sha, status: "completed", conclusion: "success", html_url: "https://github.example/actions/runs/123" }, REQUIRED_CI_JOBS.map((name) => ({ name, status: "completed", conclusion: "success" })), candidateSha); }
function inputs(overrides: Partial<ReleaseGateInputs> = {}): ReleaseGateInputs {
  return { mode: "prod", appEnvironment: "PROD", appVersion: candidateSha, fakeProvidersEnabled: false, scannerConfigured: true, backupConfigured: true, scannerEvidence: blocked(), backupEvidence: blocked(), maintenanceEvidence: blocked(), restoreEvidence: blocked(), migrationEvidence: blocked(), githubProtection: blocked(), exactHeadCi: blocked(), uatEvidence: blocked(), preflightEvidence: blocked(), ...overrides };
}

async function completeExternalEvidence() {
  return {
    scannerEvidence: await validateScannerEvidence(await evidence("scanner", "PROD", { provider: "clamav", health: "READY", cleanAccepted: true, eicarRejected: true }), candidateSha),
    backupEvidence: await validateBackupEvidence(await evidence("backup", "PROD", { provider: "tencent-cynosdb", health: "READY", backupStatus: "SUCCEEDED", sourceEnvironment: "PROD", region: "ap-shanghai", clusterId: "cluster-1", vpcId: "vpc-1", subnetId: "subnet-1", snapshotAt: "2026-08-28T12:00:00.000Z" }), candidateSha, { region: "ap-shanghai", clusterId: "cluster-1", vpcId: "vpc-1", subnetId: "subnet-1" }, new Date(verifiedAt)),
    maintenanceEvidence: await validateMaintenanceEvidence(await evidence("maintenance", "PROD", { provider: "maintenance-api", health: "READY", enterPassed: true, exitPassed: true }), candidateSha),
    restoreEvidence: await validateRestoreEvidence(await evidence("restore", "TEST", { sourceBackupId: "123", sourceClusterId: "test-source", sourceEnvironment: "TEST", targetClusterId: "test-target", targetEnvironment: "TEST", validationPassed: true, rtoHours: 2, rpoHours: 1, cleanupCompleted: true }), candidateSha),
    migrationEvidence: await validateMigrationEvidence(await evidence("migration", "TEST", { sourceSnapshotIdentity: "snapshot-1", targetMigrationDatabase: "migration-test", dryRunPassed: true, applyPassed: true, rerunPassed: true, reconciliationPassed: true }), candidateSha),
    uatEvidence: await validateUatEvidence(await evidence("uat", "TEST", { p0Open: 0, p1Open: 0, businessSignoff: true, operationsSignoff: true }), candidateSha),
    preflightEvidence: await validatePreflightEvidence(await evidence("preflight", "PROD", { checksPassed: true, rollbackReady: true, changeWindowApproved: true }), candidateSha),
    realAiEvidence: await validateAiEvidence(await evidence("ai", "PROD", { provider: "real-provider", model: "approved-model", evaluationPassed: true }), candidateSha),
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  delete process.env.REAL_RESTORE_DRILL_PASSED; delete process.env.FULL_V1_REHEARSAL_PASSED; delete process.env.UAT_SIGNED_OFF; delete process.env.REAL_MAINTENANCE_PROVIDER_READY;
});

describe("M3-008 production release evidence", () => {
  it("does not become release-ready when settings exist without real evidence", () => {
    const report = buildReleaseReadiness(inputs()); expect(report.releaseReady).toBe(false);
    expect(report.gates.find(({ code }) => code === "FILE_SCANNER_PRODUCTION_EVIDENCE")?.status).toBe("BLOCKED_BY_EXTERNAL_ENV");
  });

  it("does not accept legacy naked boolean switches as immutable evidence", () => {
    process.env.REAL_RESTORE_DRILL_PASSED = "true"; process.env.FULL_V1_REHEARSAL_PASSED = "true"; process.env.UAT_SIGNED_OFF = "true"; process.env.REAL_MAINTENANCE_PROVIDER_READY = "true";
    expect(buildReleaseReadiness(inputs()).releaseReady).toBe(false);
  });

  it("re-reads referenced content and rejects a mismatched SHA-256", async () => {
    const pointer = JSON.parse(await evidence("uat", "TEST", { p0Open: 0, p1Open: 0, businessSignoff: true, operationsSignoff: true })) as { reference: string; sourcePath: string };
    await writeFile(pointer.sourcePath, JSON.stringify({ category: "uat", candidateSha, environment: "TEST", status: "PASS", verifiedAt, details: { p0Open: 1 } }));
    await expect(validateUatEvidence(JSON.stringify(pointer), candidateSha)).resolves.toMatchObject({ status: "FAIL", errorCode: "EVIDENCE_DIGEST_MISMATCH" });
  });

  it("rejects category, candidate, environment, and category-schema mismatches", async () => {
    await expect(validateUatEvidence(await evidence("migration", "TEST", {}), candidateSha)).resolves.toMatchObject({ errorCode: "EVIDENCE_CATEGORY_MISMATCH" });
    await expect(validateUatEvidence(await evidence("uat", "TEST", { p0Open: 0, p1Open: 0, businessSignoff: true, operationsSignoff: true }, { candidateSha: "2".repeat(40) }), candidateSha)).resolves.toMatchObject({ errorCode: "EVIDENCE_CANDIDATE_SHA_MISMATCH" });
    await expect(validateGenericEvidence(await evidence("maintenance", "PROD", {}), candidateSha, "maintenance", "TEST")).resolves.toMatchObject({ errorCode: "EVIDENCE_ENVIRONMENT_MISMATCH" });
    await expect(validateUatEvidence(await evidence("uat", "TEST", { p0Open: 0, p1Open: 0, businessSignoff: true }), candidateSha)).resolves.toMatchObject({ errorCode: "UAT_EVIDENCE_INCOMPLETE" });
  });

  it("requires full migration and restore drill evidence", async () => {
    await expect(validateMigrationEvidence(await evidence("migration", "TEST", { sourceSnapshotIdentity: "snapshot", targetMigrationDatabase: "db", dryRunPassed: true, applyPassed: true, rerunPassed: true }), candidateSha)).resolves.toMatchObject({ errorCode: "MIGRATION_EVIDENCE_INCOMPLETE" });
    await expect(validateRestoreEvidence(await evidence("restore", "TEST", { sourceBackupId: "1", sourceClusterId: "source", sourceEnvironment: "TEST", targetClusterId: "target", targetEnvironment: "TEST", validationPassed: true, rtoHours: 2, rpoHours: 1 }), candidateSha)).resolves.toMatchObject({ errorCode: "RESTORE_EVIDENCE_INCOMPLETE" });
  });

  it("rejects protected=true metadata when required branch policy details are absent", () => expect(validateGithubProtection({ protected: true })).toEqual({ status: "FAIL", errorCode: "GITHUB_REQUIRED_POLICY_INCOMPLETE" }));
  it("requires allow_force_pushes to be explicitly disabled", () => { const missing: Record<string, unknown> = completeProtection(); delete missing.allow_force_pushes; expect(validateGithubProtection(completeProtection())).toEqual({ status: "PASS" }); expect(validateGithubProtection(missing)).toMatchObject({ status: "FAIL" }); });
  it("rejects a successful seven-job run bound to another SHA", () => expect(successfulCi("2".repeat(40))).toMatchObject({ status: "FAIL", errorCode: "CI_CANDIDATE_SHA_MISMATCH" }));

  it("becomes release-ready only when every production gate has verified category evidence", async () => {
    const report = buildReleaseReadiness(inputs({ ...(await completeExternalEvidence()), githubProtection: validateGithubProtection(completeProtection()), exactHeadCi: successfulCi() }), verifiedAt);
    expect(report).toMatchObject({ overall: "PASS", releaseReady: true });
  });

  it("fails closed when production evaluation runs with APP_ENV=TEST", async () => {
    const report = buildReleaseReadiness(inputs({ ...(await completeExternalEvidence()), appEnvironment: "TEST", githubProtection: validateGithubProtection(completeProtection()), exactHeadCi: successfulCi() }), verifiedAt);
    expect(report.releaseReady).toBe(false); expect(report.gates.find(({ code }) => code === "APP_ENV_VALID")).toMatchObject({ status: "FAIL", errorCode: "PRODUCTION_APP_ENV_REQUIRED" }); expect(readinessExitCode(report)).toBe(1);
  });

  it("keeps CI mode reachable with APP_ENV=TEST without declaring release readiness", () => { const report = buildReleaseReadiness(inputs({ mode: "ci", appEnvironment: "TEST" })); expect(report.releaseReady).toBe(false); expect(readinessExitCode(report)).toBe(0); });
});
