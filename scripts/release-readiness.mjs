import { mkdir, writeFile } from "node:fs/promises";
import {
  buildReleaseReadiness,
  readinessExitCode,
  validateBackupEvidence,
  validateExactHeadCi,
  validateGenericEvidence,
  validateGithubProtection,
  validateScannerEvidence,
} from "../src/modules/hardening/release-readiness.ts";

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

const [githubProtection, exactHeadCi] = await Promise.all([githubProtectionEvidence(), exactHeadCiEvidence()]);
const scannerConfigured = process.env.FILE_SCAN_PROVIDER?.toLowerCase() === "clamav" && configured("CLAMAV_HOST", "CLAMAV_PORT");
const backupConfigured = process.env.BACKUP_PROVIDER?.toLowerCase() === "tencent-cynosdb" && configured("TENCENT_CLOUD_SECRET_ID", "TENCENT_CLOUD_SECRET_KEY", "CYNOSDB_REGION", "CYNOSDB_CLUSTER_ID");

const report = buildReleaseReadiness({
  mode,
  appEnvironment,
  appVersion,
  fakeProvidersEnabled: process.env.ENABLE_FAKE_SYSTEM_PROVIDERS === "true",
  scannerConfigured,
  backupConfigured,
  scannerEvidence: validateScannerEvidence(process.env.FILE_SCANNER_EVIDENCE_JSON, appVersion),
  backupEvidence: validateBackupEvidence(process.env.CLOUD_BACKUP_EVIDENCE_JSON, appVersion, { region: process.env.CYNOSDB_REGION, clusterId: process.env.CYNOSDB_CLUSTER_ID }),
  maintenanceEvidence: validateGenericEvidence(process.env.MAINTENANCE_EVIDENCE_JSON, appVersion),
  restoreEvidence: validateGenericEvidence(process.env.RESTORE_DRILL_EVIDENCE_JSON, appVersion),
  migrationEvidence: validateGenericEvidence(process.env.V1_REHEARSAL_EVIDENCE_JSON, appVersion, "BLOCKED_BY_SOURCE_DATA"),
  githubProtection,
  exactHeadCi,
  uatEvidence: validateGenericEvidence(process.env.UAT_EVIDENCE_JSON, appVersion, "BLOCKED_BY_UAT"),
  preflightEvidence: validateGenericEvidence(process.env.PROD_PREFLIGHT_EVIDENCE_JSON, appVersion),
  realAiEvidence: validateGenericEvidence(process.env.REAL_AI_EVIDENCE_JSON, appVersion),
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
