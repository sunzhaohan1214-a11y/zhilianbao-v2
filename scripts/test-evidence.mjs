import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const ALLOWED_LAYERS = new Set(["unit", "integration", "database", "security", "e2e", "ci"]);
const TEST_LAYERS = ["unit", "integration", "database", "e2e", "security"];
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);

const evidence = (layer, filePath) => ({ layer, path: filePath });
const path = (code, description, evidenceFiles) => ({ code, description, evidence: evidenceFiles });

export const UAT_PATHS = [
  path("AUTH_AND_ROLE_NAVIGATION", "登录、激活、会话撤销与角色导航", [
    evidence("unit", "tests/unit/auth-foundation.test.ts"), evidence("database", "tests/database/auth.test.ts"), evidence("security", "tests/security/route-matrix.test.ts"), evidence("e2e", "tests/e2e/auth.spec.ts"),
  ]),
  path("ENTERPRISE_AND_CONTACT", "企业与联系人维护", [
    evidence("unit", "tests/unit/enterprise-foundation.test.ts"), evidence("database", "tests/database/enterprise.test.ts"), evidence("e2e", "tests/e2e/enterprise.spec.ts"),
  ]),
  path("DEMAND_LIFECYCLE", "需求创建、流转、归属与协作", [
    evidence("unit", "tests/unit/demand-lifecycle.test.ts"), evidence("database", "tests/database/demand-lifecycle.test.ts"), evidence("database", "tests/database/demand-claim-collaboration.test.ts"), evidence("e2e", "tests/e2e/demand-lifecycle.spec.ts"),
  ]),
  path("MEMBER_AND_PRESENCE", "团员、联系人与在宝报备", [
    evidence("unit", "tests/unit/member-foundation.test.ts"), evidence("unit", "tests/unit/presence-foundation.test.ts"), evidence("database", "tests/database/presence.test.ts"), evidence("e2e", "tests/e2e/member-contacts.spec.ts"), evidence("e2e", "tests/e2e/presence.spec.ts"),
  ]),
  path("MAP_POLICY_AND_TALENT", "地图、政策与人才", [
    evidence("unit", "tests/unit/map-foundation.test.ts"), evidence("unit", "tests/unit/policy-foundation.test.ts"), evidence("unit", "tests/unit/talent-foundation.test.ts"), evidence("database", "tests/database/map.test.ts"), evidence("database", "tests/database/policy.test.ts"), evidence("database", "tests/database/talent.test.ts"), evidence("e2e", "tests/e2e/map.spec.ts"), evidence("e2e", "tests/e2e/policy.spec.ts"), evidence("e2e", "tests/e2e/talent.spec.ts"),
  ]),
  path("TRIP_AND_VISIT", "行程与走访", [evidence("unit", "tests/unit/trip-foundation.test.ts"), evidence("database", "tests/database/trip-visit.test.ts"), evidence("e2e", "tests/e2e/trip-visit.spec.ts")]),
  path("HELP", "求助闭环", [evidence("unit", "tests/unit/help-foundation.test.ts"), evidence("database", "tests/database/help.test.ts"), evidence("e2e", "tests/e2e/help.spec.ts")]),
  path("REIMBURSEMENT", "报销权限与流程", [evidence("unit", "tests/unit/reimbursement.test.ts"), evidence("database", "tests/database/reimbursement.test.ts"), evidence("security", "tests/security/route-matrix.test.ts"), evidence("e2e", "tests/e2e/reimbursement.spec.ts")]),
  path("REPORTING_AND_NOTIFICATIONS", "月报、公告与消息", [
    evidence("unit", "tests/unit/monthly-reporting.test.ts"), evidence("unit", "tests/unit/announcement-notification.test.ts"), evidence("database", "tests/database/monthly-reporting.test.ts"), evidence("database", "tests/database/announcement-notification.test.ts"), evidence("e2e", "tests/e2e/monthly-reporting.spec.ts"), evidence("e2e", "tests/e2e/announcement-notification.spec.ts"),
  ]),
  path("ATTACHMENT_SECURITY", "附件上传、扫描与授权访问", [evidence("unit", "tests/unit/attachment-foundation.test.ts"), evidence("database", "tests/database/attachments.test.ts"), evidence("security", "scripts/clamav-integration.mjs"), evidence("e2e", "tests/e2e/auth.spec.ts")]),
  path("AI_STRUCTURED_QUERY", "荷宝结构化查询、私密拒答与安全降级", [evidence("unit", "tests/unit/ai-evaluation.test.ts"), evidence("security", "tests/security/route-matrix.test.ts"), evidence("e2e", "tests/e2e/ai-chat.spec.ts"), evidence("e2e", "tests/e2e/weak-network.spec.ts")]),
  path("SYSTEM_GOVERNANCE", "SUPER 管理与普通 ADMIN 边界", [evidence("unit", "tests/unit/system-admin.test.ts"), evidence("database", "tests/database/system-admin.test.ts"), evidence("security", "tests/security/route-matrix.test.ts"), evidence("e2e", "tests/e2e/system-admin.spec.ts")]),
  path("BROWSER_TIMEZONE_AND_WEAK_NETWORK", "浏览器、时区与弱网兼容", [evidence("unit", "tests/unit/presence-e2e-time.test.ts"), evidence("e2e", "tests/e2e/browser-compat.spec.ts"), evidence("e2e", "tests/e2e/weak-network.spec.ts")]),
];

export class UatPreflightError extends Error {
  constructor(code, message) { super(message); this.name = "UatPreflightError"; this.code = code; }
}

function fail(code, message) { throw new UatPreflightError(code, message); }

export async function buildUatPreflight({ repoRoot, candidateSha, headSha, worktreeStatus = "", candidateFiles, paths = UAT_PATHS, inventory = {}, generatedAt = new Date().toISOString() }) {
  if (!SHA_PATTERN.test(candidateSha ?? "")) fail("INVALID_CANDIDATE_SHA", "candidate SHA must be exactly 40 lowercase hexadecimal characters");
  if (!SHA_PATTERN.test(headSha ?? "") || candidateSha !== headSha) fail("CANDIDATE_SHA_MISMATCH", "candidate SHA must equal the checked-out HEAD");
  if (worktreeStatus.trim()) fail("DIRTY_WORKTREE", "tracked or untracked worktree changes prevent commit-bound evidence");

  const codes = new Set();
  const mappedPaths = [];
  for (const item of paths) {
    if (!item.code || codes.has(item.code) || !item.evidence.length) fail("INVALID_UAT_MATRIX", "UAT path codes must be unique and contain evidence");
    codes.add(item.code);
    const indexedEvidence = [];
    for (const entry of item.evidence) {
      if (!ALLOWED_LAYERS.has(entry.layer)) fail("INVALID_EVIDENCE_LAYER", `unsupported evidence layer: ${entry.layer}`);
      const candidateFile = candidateFiles.get(entry.path);
      if (!candidateFile) fail("EVIDENCE_NOT_IN_CANDIDATE", `${entry.path} is not present in candidate ${candidateSha}`);
      if (candidateFile.type !== "blob" || !REGULAR_BLOB_MODES.has(candidateFile.mode)) {
        fail("INVALID_CANDIDATE_FILE", `evidence must be a regular file in the candidate tree: ${entry.path}`);
      }
      const absolutePath = resolve(repoRoot, entry.path);
      const relativePath = relative(repoRoot, absolutePath);
      if (!relativePath || relativePath.startsWith("..") || resolve(repoRoot, relativePath) !== absolutePath) fail("INVALID_EVIDENCE_PATH", `evidence path escapes repository: ${entry.path}`);
      let stats;
      try { stats = await lstat(absolutePath); } catch { fail("EVIDENCE_MISSING", `evidence file is missing: ${entry.path}`); }
      if (stats.isSymbolicLink() || !stats.isFile()) fail("INVALID_EVIDENCE_FILE", `evidence must be a regular non-symlink file: ${entry.path}`);
      indexedEvidence.push({ ...entry, sha256: candidateFile.sha256 });
    }
    mappedPaths.push({ code: item.code, description: item.description, status: "EVIDENCE_INDEXED", evidence: indexedEvidence });
  }

  return {
    schemaVersion: "uat-automation-preflight-v1", candidateSha, generatedAt,
    status: "BLOCKED_BY_UAT", releaseReady: false, automationIsUatSignoff: false,
    inventory, paths: mappedPaths,
    blockers: [
      "Named business testers have not attached role/device/browser/timestamp evidence for this candidate.",
      "Business and operations UAT sign-off is not attached to this candidate.",
      "Automation and local/provider-stub results do not prove real TEST or production-provider acceptance.",
    ],
  };
}

async function git(repoRoot, args) {
  return (await gitBytes(repoRoot, args)).toString("utf8").trim();
}

async function gitBytes(repoRoot, args) {
  try {
    const { stdout } = await execFile("git", ["--no-replace-objects", ...args], { cwd: repoRoot, encoding: null, maxBuffer: 10 * 1024 * 1024 });
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  }
  catch { fail("GIT_BINDING_FAILED", `git ${args.join(" ")} failed`); }
}

function parseCandidateTree(bytes) {
  const files = new Map();
  for (const record of bytes.toString("utf8").split("\0").filter(Boolean)) {
    const match = /^(\d+) ([^ ]+) ([0-9a-f]+)\t(.*)$/s.exec(record);
    if (!match) fail("GIT_TREE_PARSE_FAILED", "candidate tree contains an unparseable entry");
    files.set(match[4], { mode: match[1], type: match[2], objectSha: match[3] });
  }
  return files;
}

export function countCandidateTests(candidateTree) {
  return Object.fromEntries(TEST_LAYERS.map((layer) => [layer, [...candidateTree].filter(([filePath, entry]) => (
    filePath.startsWith(`tests/${layer}/`)
    && /\.(?:test|spec)\.(?:ts|tsx)$/.test(filePath)
    && entry.type === "blob"
    && REGULAR_BLOB_MODES.has(entry.mode)
  )).length]));
}

function parseArguments(argv) {
  const options = { stdoutOnly: false };
  for (const argument of argv) {
    if (argument === "--stdout-only") options.stdoutOnly = true;
    else if (argument.startsWith("--candidate-sha=")) options.candidateSha = argument.slice("--candidate-sha=".length);
    else fail("INVALID_ARGUMENT", `unsupported argument: ${argument}`);
  }
  return options;
}

function renderMarkdown(report) {
  const rows = report.paths.map((item) => `| ${item.code} | ${item.status} | ${item.evidence.map((entry) => `${entry.layer}: \`${entry.path}\``).join("<br>")} |`).join("\n");
  return `# UAT automation preflight evidence\n\n- Candidate SHA: \`${report.candidateSha}\`\n- Status: \`${report.status}\`\n- Release ready: \`NO\`\n- Generated at: \`${report.generatedAt}\`\n\nAutomation evidence is not named UAT sign-off.\n\n| UAT path | Automation status | Candidate-bound evidence |\n| --- | --- | --- |\n${rows}\n\n## Remaining blockers\n\n${report.blockers.map((blocker) => `- ${blocker}`).join("\n")}\n`;
}

export async function prepareFileOutput(outputDirectory, outputFiles) {
  let stats;
  try {
    stats = await lstat(outputDirectory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await mkdir(outputDirectory, { recursive: true });
    stats = await lstat(outputDirectory);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    fail("INVALID_OUTPUT_DIRECTORY", "artifacts output must be a regular directory, not a symlink or other file");
  }
  await Promise.all(outputFiles.map((filePath) => rm(filePath, { force: true })));
}

async function main() {
  const repoRoot = process.cwd();
  const arguments_ = process.argv.slice(2);
  const outputDirectory = resolve(repoRoot, "artifacts");
  const outputFiles = [
    resolve(outputDirectory, "uat-automation-preflight.json"),
    resolve(outputDirectory, "uat-automation-preflight.md"),
  ];
  const stdoutOnlyRequested = arguments_.includes("--stdout-only");
  if (!stdoutOnlyRequested) {
    await prepareFileOutput(outputDirectory, outputFiles);
  }
  const options = parseArguments(arguments_);
  const headSha = await git(repoRoot, ["rev-parse", "HEAD"]);
  const candidateSha = options.candidateSha ?? process.env.GITHUB_SHA ?? headSha;
  if (!SHA_PATTERN.test(candidateSha)) fail("INVALID_CANDIDATE_SHA", "candidate SHA must be exactly 40 lowercase hexadecimal characters");
  if (candidateSha !== headSha) fail("CANDIDATE_SHA_MISMATCH", "candidate SHA must equal the checked-out HEAD");
  const worktreeStatus = await git(repoRoot, ["status", "--porcelain", "--untracked-files=all"]);
  const candidateTree = parseCandidateTree(await gitBytes(repoRoot, ["ls-tree", "-r", "-z", candidateSha]));
  const evidencePaths = new Set(UAT_PATHS.flatMap((item) => item.evidence.map((entry) => entry.path)));
  const candidateFiles = new Map();
  await Promise.all([...evidencePaths].map(async (evidencePath) => {
    const treeEntry = candidateTree.get(evidencePath);
    if (!treeEntry) return;
    const bytes = await gitBytes(repoRoot, ["cat-file", "blob", treeEntry.objectSha]);
    candidateFiles.set(evidencePath, { ...treeEntry, sha256: createHash("sha256").update(bytes).digest("hex") });
  }));
  const inventory = countCandidateTests(candidateTree);
  const report = await buildUatPreflight({ repoRoot, candidateSha, headSha, worktreeStatus, candidateFiles, inventory });
  if (!options.stdoutOnly) {
    await writeFile(outputFiles[0], `${JSON.stringify(report, null, 2)}\n`);
    await writeFile(outputFiles[1], renderMarkdown(report));
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = error instanceof UatPreflightError ? error.code : "UAT_PREFLIGHT_FAILED";
    console.error(`${code}: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
