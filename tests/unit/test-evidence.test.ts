import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// @ts-expect-error The production evidence entrypoint is intentionally plain Node ESM.
import { buildUatPreflight } from "../../scripts/test-evidence.mjs";

const candidateSha = "1".repeat(40);
const temporaryDirectories: string[] = [];

async function fixture() {
  const repoRoot = await mkdtemp(join(tmpdir(), "zlb-uat-evidence-"));
  temporaryDirectories.push(repoRoot);
  const evidencePath = "tests/unit/example.test.ts";
  await mkdir(join(repoRoot, "tests/unit"), { recursive: true });
  await writeFile(join(repoRoot, evidencePath), "export {};\n");
  return {
    evidencePath,
    input: {
      repoRoot,
      candidateSha,
      headSha: candidateSha,
      trackedPaths: [evidencePath],
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
    await expect(buildUatPreflight({ ...input, trackedPaths: [] })).rejects.toMatchObject({ code: "EVIDENCE_NOT_IN_CANDIDATE" });
    await rm(join(input.repoRoot, evidencePath));
    await expect(buildUatPreflight(input)).rejects.toMatchObject({ code: "EVIDENCE_MISSING" });
  });
});
