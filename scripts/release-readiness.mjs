import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  buildReleaseReadiness,
  readinessExitCode,
  validateAiEvidence,
  validateBackupEvidence,
  validateMaintenanceEvidence,
  validateMigrationEvidence,
  validatePreflightEvidence,
  validateRestoreEvidence,
  validateScannerEvidence,
  validateUatEvidence,
} from "../src/modules/hardening/release-readiness.ts";

const execFileAsync = promisify(execFile);
const rawMode = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ?? "local";
if (!["local", "ci", "prod"].includes(rawMode)) throw new Error("RELEASE_MODE_INVALID");
const mode = rawMode;
const appEnvironment = (process.env.APP_ENV ?? "UNKNOWN").toUpperCase();
const appVersion = process.env.APP_VERSION?.trim() || "UNKNOWN";
const configured = (...names) => names.every((name) => Boolean(process.env[name]?.trim()));

let migrationBundlePromise;
async function ensureMigrationBundle() {
  if (!migrationBundlePromise) {
    const npmExecPath = process.env.npm_execpath?.trim();
    if (!npmExecPath) throw new Error("MIGRATION_TARGET_STATE_BUILD_UNAVAILABLE");
    migrationBundlePromise = execFileAsync(process.execPath, [npmExecPath, "run", "build:migration", "--silent"], {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 4 * 1024 * 1024,
    });
  }
  await migrationBundlePromise;
}

function requireIdempotentRerunActions(evidence) {
  const counts = evidence?.actionCounts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)
    || !Number.isSafeInteger(evidence.sourceActionCount) || evidence.sourceActionCount < 0) {
    throw new Error("MIGRATION_RERUN_WRITE_ATTESTATION_INVALID");
  }
  const actions = ["CREATE", "LINK", "UPDATE", "SKIP", "REVIEW", "FAILED"];
  if (Object.keys(counts).length !== actions.length || !actions.every((action) => Number.isSafeInteger(counts[action]) && counts[action] >= 0)) {
    throw new Error("MIGRATION_RERUN_WRITE_ATTESTATION_INVALID");
  }
  const total = actions.reduce((sum, action) => sum + counts[action], 0);
  if (total !== evidence.sourceActionCount || counts.CREATE !== 0 || counts.LINK !== 0 || counts.UPDATE !== 0
    || counts.REVIEW !== 0 || counts.FAILED !== 0 || counts.SKIP !== evidence.sourceActionCount) {
    throw new Error("MIGRATION_RERUN_WRITE_ATTESTATION_INVALID");
  }
}

async function attestMigrationTargetState(request) {
  if (mode !== "prod") throw new Error("MIGRATION_TARGET_STATE_ATTESTATION_PROD_ONLY");
  const migrationDatabaseUrl = process.env.V1_MIGRATION_DATABASE_URL?.trim();
  if (!migrationDatabaseUrl) throw new Error("V1_MIGRATION_DATABASE_URL_REQUIRED");
  await ensureMigrationBundle();

  const directory = await mkdtemp(join(tmpdir(), "zlb-release-migration-attestation-"));
  const output = join(directory, `${request.phase.toLowerCase()}-target-state.json`);
  const childEnv = {
    ...process.env,
    APP_ENV: "test",
    APP_VERSION: request.candidateSha,
    V1_MIGRATION_APPROVED_TARGET_ENVIRONMENT: request.targetEnvironment,
    V1_MIGRATION_APPROVED_TARGET_DATABASE: request.targetMigrationDatabase,
  };
  childEnv.DATABASE_URL = migrationDatabaseUrl;
  try {
    await execFileAsync(process.execPath, [
      join(process.cwd(), "migration-dist", "target-state-main.js"),
      "--batch", request.batchId,
      "--candidate-sha", request.candidateSha,
      "--manifest-sha", request.manifestSha256,
      "--output", output,
    ], {
      cwd: process.cwd(),
      env: childEnv,
      maxBuffer: 4 * 1024 * 1024,
    });
    const evidence = JSON.parse(await readFile(output, "utf8"));
    if (request.phase === "RERUN") requireIdempotentRerunActions(evidence);
    return evidence;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const [githubProtection, exactHeadCi, scannerEvidence, backupEvidence, maintenanceEvidence, restoreEvidence, migrationEvidence, uatEvidence, preflightEvidence, realAiEvidence] = await Promise.all([
  Promise.resolve({ status: "NOT_APPLICABLE", evidenceRef: "public-github-version-control-only" }),
  Promise.resolve({ status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: "LOCAL_EXACT_SHA_EVIDENCE_REQUIRED" }),
  validateScannerEvidence(process.env.FILE_SCANNER_EVIDENCE_JSON, appVersion),
  validateBackupEvidence(process.env.CLOUD_BACKUP_EVIDENCE_JSON, appVersion, {}),
  validateMaintenanceEvidence(process.env.MAINTENANCE_EVIDENCE_JSON, appVersion),
  validateRestoreEvidence(process.env.RESTORE_DRILL_EVIDENCE_JSON, appVersion),
  validateMigrationEvidence(process.env.V1_REHEARSAL_EVIDENCE_JSON, appVersion, {
    environment: process.env.V1_MIGRATION_APPROVED_TARGET_ENVIRONMENT,
    databaseId: process.env.V1_MIGRATION_APPROVED_TARGET_DATABASE,
  }, attestMigrationTargetState),
  validateUatEvidence(process.env.UAT_EVIDENCE_JSON, appVersion),
  validatePreflightEvidence(process.env.PROD_PREFLIGHT_EVIDENCE_JSON, appVersion),
  validateAiEvidence(process.env.REAL_AI_EVIDENCE_JSON, appVersion),
]);
const scannerConfigured = process.env.FILE_SCAN_PROVIDER?.toLowerCase() === "clamav" && configured("CLAMAV_HOST", "CLAMAV_PORT");
const backupConfigured = false;

const report = buildReleaseReadiness({
  mode,
  appEnvironment,
  appVersion,
  fakeProvidersEnabled: process.env.ENABLE_FAKE_SYSTEM_PROVIDERS === "true",
  scannerConfigured,
  backupConfigured,
  scannerEvidence,
  backupEvidence,
  maintenanceEvidence,
  restoreEvidence,
  migrationEvidence,
  githubProtection,
  exactHeadCi,
  uatEvidence,
  preflightEvidence,
  realAiEvidence,
});

await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/release-readiness.json", `${JSON.stringify(report, null, 2)}\n`);
const lines = [
  "# Release Readiness", "", `- Mode: ${report.mode}`, `- Candidate SHA: ${appVersion}`, `- Overall: ${report.overall}`,
  `- RELEASE_READY: ${report.releaseReady ? "YES" : "NO"}`, "",
  "| Gate | Category | Status | Evidence | Error code |", "|---|---|---|---|---|",
  ...report.gates.map((gate) => `| ${gate.code} | ${gate.category} | ${gate.status} | ${gate.evidenceRef ?? ""} | ${gate.errorCode ?? ""} |`),
];
await writeFile("artifacts/release-readiness.md", `${lines.join("\n")}\n`);
console.log(JSON.stringify({ timestamp: report.timestamp, mode, status: report.overall, releaseReady: report.releaseReady, candidateSha: appVersion, artifacts: ["artifacts/release-readiness.json", "artifacts/release-readiness.md"] }));
process.exitCode = readinessExitCode(report);
