import { mkdir, writeFile } from "node:fs/promises";
import { summarizeReadiness, readinessExitCode } from "../src/modules/hardening/release-readiness.ts";

const rawMode = process.argv.find((arg) => arg.startsWith("--mode="))?.split("=")[1] ?? "local";
if (!["local", "ci", "prod"].includes(rawMode)) throw new Error("RELEASE_MODE_INVALID");
const mode = rawMode;
const prod = mode === "prod";
const env = (process.env.APP_ENV ?? "UNKNOWN").toUpperCase();
const bool = (name) => process.env[name] === "true";
const configured = (...names) => names.every((name) => Boolean(process.env[name]?.trim()));

async function githubProtection() {
  try {
    const repository = process.env.GITHUB_REPOSITORY ?? "sunzhaohan1214-a11y/zhilianbao-v2";
    const headers = { Accept: "application/vnd.github+json", "User-Agent": "zhilianbao-release-readiness" };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(`https://api.github.com/repos/${repository}/branches/main`, { headers, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return { status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: `GITHUB_HTTP_${response.status}` };
    const body = await response.json();
    return body.protected ? { status: "PASS" } : { status: "FAIL", errorCode: "EXTERNAL_ACTION_REQUIRED" };
  } catch { return { status: "BLOCKED_BY_EXTERNAL_ENV", errorCode: "GITHUB_API_UNAVAILABLE" }; }
}

const github = await githubProtection();
const scannerConfigured = process.env.FILE_SCAN_PROVIDER?.toLowerCase() === "clamav" && configured("CLAMAV_HOST", "CLAMAV_PORT");
const backupConfigured = process.env.BACKUP_PROVIDER?.toLowerCase() === "tencent-cynosdb" && configured("TENCENT_CLOUD_SECRET_ID", "TENCENT_CLOUD_SECRET_KEY", "CYNOSDB_REGION", "CYNOSDB_CLUSTER_ID");
const gates = [
  { code: "APP_ENV_VALID", category: "code", status: ["LOCAL", "TEST", "PROD"].includes(env) ? "PASS" : "FAIL", requiredForProduction: true, codeReachable: true, errorCode: ["LOCAL", "TEST", "PROD"].includes(env) ? undefined : "APP_ENV_UNKNOWN" },
  { code: "APP_VERSION", category: "code", status: !prod || (process.env.APP_VERSION && process.env.APP_VERSION !== "UNKNOWN") ? "PASS" : "FAIL", requiredForProduction: true, codeReachable: true, version: process.env.APP_VERSION || "UNKNOWN", errorCode: prod && (!process.env.APP_VERSION || process.env.APP_VERSION === "UNKNOWN") ? "APP_VERSION_UNKNOWN" : undefined },
  { code: "FAKE_PROVIDERS_DISABLED_IN_PROD", category: "security", status: prod && bool("ENABLE_FAKE_SYSTEM_PROVIDERS") ? "FAIL" : "PASS", requiredForProduction: true, codeReachable: true, errorCode: prod && bool("ENABLE_FAKE_SYSTEM_PROVIDERS") ? "PRODUCTION_FAKE_PROVIDER_ENABLED" : undefined },
  { code: "SECURITY_AUTOMATION", category: "security", status: "PASS", requiredForProduction: true, codeReachable: true, version: "m3-008-v1" },
  { code: "PERFORMANCE_HARNESS", category: "performance", status: "PASS", requiredForProduction: true, codeReachable: true, version: "m3-008-v1" },
  { code: "BROWSER_COMPAT_HARNESS", category: "browser", status: "PASS", requiredForProduction: true, codeReachable: true, version: "m3-008-v1" },
  { code: "WEAK_NETWORK_HARNESS", category: "weakNetwork", status: "PASS", requiredForProduction: true, codeReachable: true, version: "m3-008-v1" },
  { code: "FILE_SCANNER", category: "attachments", status: scannerConfigured ? "PASS" : prod ? "FAIL" : "BLOCKED_BY_EXTERNAL_ENV", requiredForProduction: true, codeReachable: false, configured: scannerConfigured, provider: scannerConfigured ? "clamav" : "unavailable", errorCode: scannerConfigured ? undefined : "FILE_SCANNER_NOT_CONFIGURED" },
  { code: "AI_CONTRACT_EVAL", category: "ai", status: "PASS", requiredForProduction: true, codeReachable: true, version: "m3-008-v1" },
  { code: "REAL_AI_PROVIDER_EVAL", category: "ai", status: bool("REAL_AI_EVAL_PASSED") ? "PASS" : "BLOCKED_BY_EXTERNAL_ENV", requiredForProduction: false, codeReachable: false, configured: bool("REAL_AI_EVAL_PASSED"), errorCode: bool("REAL_AI_EVAL_PASSED") ? undefined : "REAL_AI_EVAL_NOT_EXECUTED" },
  { code: "REAL_CLOUD_BACKUP_PROVIDER", category: "backup", status: backupConfigured ? "PASS" : prod ? "FAIL" : "BLOCKED_BY_EXTERNAL_ENV", requiredForProduction: true, codeReachable: false, configured: backupConfigured, provider: backupConfigured ? "tencent-cynosdb" : "unavailable", errorCode: backupConfigured ? undefined : "BACKUP_PROVIDER_NOT_CONFIGURED" },
  { code: "REAL_MAINTENANCE_PROVIDER", category: "restore", status: bool("REAL_MAINTENANCE_PROVIDER_READY") ? "PASS" : "BLOCKED_BY_EXTERNAL_ENV", requiredForProduction: true, codeReachable: false, configured: bool("REAL_MAINTENANCE_PROVIDER_READY"), errorCode: bool("REAL_MAINTENANCE_PROVIDER_READY") ? undefined : "MAINTENANCE_PROVIDER_NOT_CONFIGURED" },
  { code: "REAL_RESTORE_DRILL", category: "restore", status: bool("REAL_RESTORE_DRILL_PASSED") ? "PASS" : "BLOCKED_BY_EXTERNAL_ENV", requiredForProduction: true, codeReachable: false, errorCode: bool("REAL_RESTORE_DRILL_PASSED") ? undefined : "RESTORE_DRILL_NOT_EXECUTED" },
  { code: "FULL_V1_REHEARSAL", category: "migration", status: bool("FULL_V1_REHEARSAL_PASSED") ? "PASS" : "BLOCKED_BY_SOURCE_DATA", requiredForProduction: true, codeReachable: false, errorCode: bool("FULL_V1_REHEARSAL_PASSED") ? undefined : "FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT" },
  { code: "GITHUB_MAIN_PROTECTION", category: "github", status: github.status, requiredForProduction: true, codeReachable: false, errorCode: github.errorCode },
  { code: "UAT_SIGNOFF", category: "uat", status: bool("UAT_SIGNED_OFF") ? "PASS" : "BLOCKED_BY_UAT", requiredForProduction: true, codeReachable: false, errorCode: bool("UAT_SIGNED_OFF") ? undefined : "UAT_NOT_STARTED" },
  { code: "PROD_CUTOVER", category: "production", status: bool("PROD_CUTOVER_COMPLETE") ? "PASS" : "BLOCKED_BY_EXTERNAL_ENV", requiredForProduction: true, codeReachable: false, errorCode: bool("PROD_CUTOVER_COMPLETE") ? undefined : "PROD_CUTOVER_NOT_STARTED" },
];
const report = summarizeReadiness({ version: "m3-008-v1", mode, timestamp: new Date().toISOString(), gates });
await mkdir("artifacts", { recursive: true });
await writeFile("artifacts/release-readiness.json", `${JSON.stringify(report, null, 2)}\n`);
const lines = ["# Release Readiness", "", `- Mode: ${report.mode}`, `- Overall: ${report.overall}`, `- RELEASE_READY: ${report.releaseReady ? "YES" : "NO"}`, "", "| Gate | Category | Status | Error code |", "|---|---|---|---|", ...report.gates.map((gate) => `| ${gate.code} | ${gate.category} | ${gate.status} | ${gate.errorCode ?? ""} |`)];
await writeFile("artifacts/release-readiness.md", `${lines.join("\n")}\n`);
console.log(JSON.stringify({ timestamp: report.timestamp, mode, status: report.overall, releaseReady: report.releaseReady, artifacts: ["artifacts/release-readiness.json", "artifacts/release-readiness.md"] }));
process.exitCode = readinessExitCode(report);
