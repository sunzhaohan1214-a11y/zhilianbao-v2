import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error The production evidence entrypoint is intentionally plain Node ESM.
import { UAT_PATHS, buildUatPreflight, countCandidateTests, prepareFileOutput } from "../../scripts/test-evidence.mjs";

const candidateSha = "1".repeat(40);
const temporaryDirectories: string[] = [];

async function fixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "zlb-uat-evidence-"));
  temporaryDirectories.push(repoRoot);
  const evidencePath = "tests/unit/example.test.ts";
  await mkdir(join(repoRoot, "tests/unit"), { recursive: true });
  const candidateBytes = "export {};\n";
  await writeFile(join(repoRoot, evidencePath), candidateBytes);
  return {
    evidencePath,
    candidateBytes,
    input: {
      repoRoot,
      candidateSha,
      headSha: candidateSha,
      candidateFiles: new Map([[evidencePath, {
        mode: "100644",
        type: "blob",
        sha256: createHash("sha256").update(candidateBytes).digest("hex"),
      }]]),
      paths: [{ code: "EXAMPLE", description: "example", evidence: [{ layer: "unit", path: evidencePath }] }],
      inventory: { unit: 1 },
      generatedAt: "2026-09-01T00:00:00.000Z",
    },
  };
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("UAT automation preflight evidence", () => {
  it("binds the local structured chat safety path into the AI evidence index", () => {
    const aiPath = UAT_PATHS.find((item: { code: string }) => item.code === "AI_STRUCTURED_QUERY");
    expect(aiPath?.evidence).toContainEqual({ layer: "e2e", path: "tests/e2e/ai-chat.spec.ts" });
  });

  it("binds evidence to a 40-character candidate SHA and remains BLOCKED_BY_UAT", async () => {
    const { input } = await fixture();
    const report = await buildUatPreflight(input);
    expect(report).toMatchObject({ candidateSha, status: "BLOCKED_BY_UAT", releaseReady: false, automationIsUatSignoff: false });
    expect(report.paths[0].evidence[0].sha256).toBe(createHash("sha256").update("export {};\n").digest("hex"));
  });

  it("rejects malformed or mismatched candidate SHAs", async () => {
    const { input } = await fixture();
    await expect(buildUatPreflight({ ...input, candidateSha: "short" })).rejects.toMatchObject({ code: "INVALID_CANDIDATE_SHA" });
    await expect(buildUatPreflight({ ...input, headSha: "2".repeat(40) })).rejects.toMatchObject({ code: "CANDIDATE_SHA_MISMATCH" });
  });

  it("fails closed for a dirty worktree, uncommitted path, or missing evidence file", async () => {
    const { input, evidencePath } = await fixture();
    await expect(buildUatPreflight({ ...input, worktreeStatus: "?? untracked" })).rejects.toMatchObject({ code: "DIRTY_WORKTREE" });
    await expect(buildUatPreflight({ ...input, candidateFiles: new Map() })).rejects.toMatchObject({ code: "EVIDENCE_NOT_IN_CANDIDATE" });
    await rm(join(input.repoRoot, evidencePath));
    await expect(buildUatPreflight(input)).rejects.toMatchObject({ code: "EVIDENCE_MISSING" });
  });

  it("hashes the candidate blob instead of changed working-tree bytes", async () => {
    const { input, evidencePath, candidateBytes } = await fixture();
    await writeFile(join(input.repoRoot, evidencePath), "locally changed but hidden from status\n");
    const report = await buildUatPreflight(input);
    expect(report.paths[0].evidence[0].sha256).toBe(createHash("sha256").update(candidateBytes).digest("hex"));
  });

  it("counts test inventory from the candidate tree instead of local files", () => {
    const regularBlob = { mode: "100644", type: "blob" };
    const candidateTree = new Map([
      ["tests/unit/tracked.test.ts", regularBlob],
      ["tests/unit/nested/tracked.spec.tsx", regularBlob],
      ["tests/e2e/tracked.spec.ts", regularBlob],
      ["tests/security/link.test.ts", { mode: "120000", type: "blob" }],
      ["docs/not-a-test.test.ts", regularBlob],
    ]);

    expect(countCandidateTests(candidateTree)).toEqual({ unit: 2, integration: 0, database: 0, e2e: 1, security: 0 });
  });

  it("rejects a symlinked artifacts directory without deleting external reports", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "zlb-uat-output-"));
    const externalDirectory = await mkdtemp(join(tmpdir(), "zlb-uat-external-"));
    temporaryDirectories.push(repoRoot, externalDirectory);
    const externalReport = join(externalDirectory, "uat-automation-preflight.json");
    await writeFile(externalReport, "stale but external\n");
    await symlink(externalDirectory, join(repoRoot, "artifacts"), "dir");

    await expect(prepareFileOutput(join(repoRoot, "artifacts"), [
      join(repoRoot, "artifacts", "uat-automation-preflight.json"),
    ])).rejects.toMatchObject({ code: "INVALID_OUTPUT_DIRECTORY" });
    await expect(readFile(externalReport, "utf8")).resolves.toBe("stale but external\n");
  });
});
