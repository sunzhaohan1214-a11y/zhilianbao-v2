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
  validateExactHeadCi,
  validateGithubProtection,
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
const appVersion = process.env.APP_VERSION?.trim() || process.env.GITHUB_SHA?.trim() || "UNKNOWN";
const configured = (...names) => names.every((name) => Boolean(process.env[name]?.trim()));
const repository = process.env.GITHUB_REPOSITORY ?? "sunzhaohan1214-a11y/zhilianbao-v2";
const headers = { Accept: "application/vnd.github+json", "User-Agent": "zhilianbao-release-readiness", "X-GitHub-Api-Version": "2022-11-28" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

async function githubJson(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { headers, signal: AbortSignal.timeout(8_000) });
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, body: await response.json() };
}

async function githubProtectionEvidence() {
  try {
    const response = await githubJson("/branches/main/protection");
    if (!response.ok) return response.status === 404
      ? { status: "FAIL", errorCode: "GITHUB_MAIN_UNPROTECTED" }
      : { status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: `GITHUB_PROTECTION_HTTP_${response.status}` };
    return validateGithubProtection(response.body);
  } catch { return { status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: "GITHUB_API_UNAVAILABLE" }; }
}

async function exactHeadCiEvidence() {
  const runId = process.env.GITHUB_CANDIDATE_RUN_ID?.trim() || process.env.GITHUB_RUN_ID?.trim();
  if (!runId || !/^\d+$/.test(runId)) return { status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: "GITHUB_CANDIDATE_RUN_ID_MISSING" };
  try {
    const [run, jobs] = await Promise.all([githubJson(`/actions/runs/${runId}`), githubJson(`/actions/runs/${runId}/jobs?per_page=100`)]);
    if (!run.ok || !jobs.ok) return { status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: `GITHUB_CI_HTTP_${!run.ok ? run.status : jobs.status}` };
    return validateExactHeadCi(run.body, jobs.body.jobs ?? [], appVersion);
  } catch { return { status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: "GITHUB_CI_API_UNAVAILABLE" }; }
}

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
  try {
    await execFileAsync(process.execPath, [
      join(process.cwd(), "migration-dist", "target-state-main.js"),
      "--batch", request.batchId,
      "--candidate-sha", request.candidateSha,
      "--manifest-sha", request.manifestSha256,
      "--output", output,
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        APP_ENV: "test",
        APP_VERSION: request.candidateSha,
        DATABASE_URL: migrationDatabaseUrl,
        V1_MIGRATION_APPROVED_TARGET_ENVIRONMENT: request.targetEnvironment,
        V1_MIGRATION_APPROVED_TARGET_DATABASE: request.targetMigrationDatabase,
      },
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
  githubProtectionEvidence(),
  exactHeadCiEvidence(),
  validateScannerEvidence(process.env.FILE_SCANNER_EVIDENCE_JSON, appVersion),
  validateBackupEvidence(process.env.CLOUD_BACKUP_EVIDENCE_JSON, appVersion, { region: process.env.CYNOSDB_APPROVED_REGION, clusterId: process.env.CYNOSDB_APPROVED_CLUSTER_ID, vpcId: process.env.CYNOSDB_APPROVED_VPC_ID, subnetId: process.env.CYNOSDB_APPROVED_SUBNET_ID }),
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
const backupConfigured = process.env.BACKUP_PROVIDER?.toLowerCase() === "tencent-cynosdb" && configured(
  "TENCENT_CLOUD_SECRET_ID", "TENCENT_CLOUD_SECRET_KEY", "CYNOSDB_REGION", "CYNOSDB_CLUSTER_ID",
  "CYNOSDB_APPROVED_ENVIRONMENT", "CYNOSDB_APPROVED_CLUSTER_ID", "CYNOSDB_APPROVED_REGION", "CYNOSDB_APPROVED_VPC_ID", "CYNOSDB_APPROVED_SUBNET_ID",
) && process.env.CYNOSDB_APPROVED_ENVIRONMENT?.toUpperCase() === appEnvironment
  && process.env.CYNOSDB_CLUSTER_ID === process.env.CYNOSDB_APPROVED_CLUSTER_ID
  && process.env.CYNOSDB_REGION === process.env.CYNOSDB_APPROVED_REGION;

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