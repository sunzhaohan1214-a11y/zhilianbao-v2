import { afterEach, describe, expect, it } from "vitest";
import {
  REQUIRED_CI_JOBS,
  buildReleaseReadiness,
  validateBackupEvidence,
  validateExactHeadCi,
  validateGenericEvidence,
  validateGithubProtection,
  validateScannerEvidence,
  type EvidenceValidation,
  type ReleaseGateInputs,
} from "@/modules/hardening/release-readiness";

const candidateSha = "1".repeat(40);
const evidenceReference = `urn:sha256:${"a".repeat(64)}`;
const verifiedAt = "2026-08-29T00:00:00.000Z";
const bound = (details: Record<string, unknown> = {}) => JSON.stringify({ reference: evidenceReference, candidateSha, status: "PASS", verifiedAt, details });
const blocked = (): EvidenceValidation => ({ status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: "TEST_EVIDENCE_MISSING" });

function completeProtection() {
  return {
    required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true },
    required_status_checks: { contexts: [...REQUIRED_CI_JOBS] },
    required_conversation_resolution: { enabled: true },
    enforce_admins: { enabled: true },
    allow_force_pushes: { enabled: false },
  };
}

function successfulCi(sha = candidateSha) {
  return validateExactHeadCi(
    { head_sha: sha, status: "completed", conclusion: "success", html_url: "https://github.example/actions/runs/123" },
    REQUIRED_CI_JOBS.map((name) => ({ name, status: "completed", conclusion: "success" })),
    candidateSha,
  );
}

function inputs(overrides: Partial<ReleaseGateInputs> = {}): ReleaseGateInputs {
  return {
    mode: "prod", appEnvironment: "PROD", appVersion: candidateSha, fakeProvidersEnabled: false,
    scannerConfigured: true, backupConfigured: true,
    scannerEvidence: blocked(), backupEvidence: blocked(), maintenanceEvidence: blocked(), restoreEvidence: blocked(), migrationEvidence: blocked(),
    githubProtection: blocked(), exactHeadCi: blocked(), uatEvidence: blocked(), preflightEvidence: blocked(),
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.REAL_RESTORE_DRILL_PASSED;
  delete process.env.FULL_V1_REHEARSAL_PASSED;
  delete process.env.UAT_SIGNED_OFF;
  delete process.env.REAL_MAINTENANCE_PROVIDER_READY;
});

describe("M3-008 production release evidence", () => {
  it("does not become release-ready when every provider setting is configured without real evidence", () => {
    const report = buildReleaseReadiness(inputs());
    expect(report.releaseReady).toBe(false);
    expect(report.gates.find(({ code }) => code === "FILE_SCANNER_CONFIGURED")?.status).toBe("PASS");
    expect(report.gates.find(({ code }) => code === "FILE_SCANNER_PRODUCTION_EVIDENCE")?.status).toBe("BLOCKED_BY_EXTERNAL_ENV");
  });

  it("does not accept legacy naked boolean switches as immutable evidence", () => {
    process.env.REAL_RESTORE_DRILL_PASSED = "true";
    process.env.FULL_V1_REHEARSAL_PASSED = "true";
    process.env.UAT_SIGNED_OFF = "true";
    process.env.REAL_MAINTENANCE_PROVIDER_READY = "true";
    const report = buildReleaseReadiness(inputs());
    expect(report.releaseReady).toBe(false);
    expect(report.gates.filter(({ code }) => ["REAL_RESTORE_DRILL_EVIDENCE", "FULL_V1_REHEARSAL_EVIDENCE", "UAT_SIGNOFF_EVIDENCE"].includes(code)).every(({ status }) => status !== "PASS")).toBe(true);
  });

  it("rejects protected=true metadata when required branch policy details are absent", () => {
    expect(validateGithubProtection({ protected: true })).toEqual({ status: "FAIL", errorCode: "GITHUB_REQUIRED_POLICY_INCOMPLETE" });
  });

  it("rejects a successful seven-job run bound to a different candidate SHA", () => {
    expect(successfulCi("2".repeat(40))).toMatchObject({ status: "FAIL", errorCode: "CI_CANDIDATE_SHA_MISMATCH" });
  });

  it("becomes release-ready only when every production gate has valid candidate-bound evidence", () => {
    const generic = validateGenericEvidence(bound({ outcome: "verified" }), candidateSha);
    const scanner = validateScannerEvidence(bound({ provider: "clamav", health: "READY", cleanAccepted: true, eicarRejected: true }), candidateSha);
    const backup = validateBackupEvidence(bound({ provider: "tencent-cynosdb", health: "READY", backupStatus: "SUCCEEDED", region: "ap-shanghai", clusterId: "cluster-1", snapshotAt: "2026-08-28T12:00:00.000Z" }), candidateSha, { region: "ap-shanghai", clusterId: "cluster-1" }, new Date("2026-08-29T00:00:00.000Z"));
    const report = buildReleaseReadiness(inputs({
      scannerEvidence: scanner, backupEvidence: backup, maintenanceEvidence: generic, restoreEvidence: generic, migrationEvidence: generic,
      githubProtection: validateGithubProtection(completeProtection()), exactHeadCi: successfulCi(), uatEvidence: generic, preflightEvidence: generic,
    }), "2026-08-29T00:00:00.000Z");
    expect(report).toMatchObject({ overall: "PASS", releaseReady: true });
  });
});
