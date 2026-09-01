import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  manifestAllowsApply,
  manifestAllowsFullRehearsal,
  snapshotManifestSchema,
} from "@/modules/migration/source-contract";
import { assertPrivateMigrationOutput } from "@/modules/migration/private-output-guard";
import { privateAttachmentRelativePath, resolvePrivateAttachmentDestination } from "@/modules/migration/private-attachment-path";
import { SnapshotDirectoryLegacySourceProvider, ENTITY_FILES } from "@/modules/migration/snapshot-provider";
import { runMigrationPreview } from "@/modules/migration/preview-runner";
import { assertLegacyMemberIdPathSafe } from "@/modules/migration/v1-package-adapter";
import { LEGACY_ENTITY_TYPES } from "@/modules/migration/types";

const temporaryRoots: string[] = [];

function digest(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function createGovernedReferenceSnapshot() {
  const root = await mkdtemp(path.join(tmpdir(), "v1-reference-security-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "entities"), { recursive: true });
  await mkdir(path.join(root, "attachments", "blobs"), { recursive: true });
  await mkdir(path.join(root, "governance"), { recursive: true });

  const files: Record<string, { count: number; sha256: string }> = {};
  for (const entityType of LEGACY_ENTITY_TYPES) {
    const relative = ENTITY_FILES[entityType];
    const body = entityType === "ORGANIZATION"
      ? `${JSON.stringify({ sourceId: "ORG-CANDIDATE", name: "待审核组织", organizationType: "DISPATCH_UNIT", status: "INACTIVE" })}\n`
      : "";
    await writeFile(path.join(root, relative), body, "utf8");
    files[relative] = { count: body ? 1 : 0, sha256: digest(body) };
  }
  const attachmentManifest = "";
  await writeFile(path.join(root, "attachments", "manifest.ndjson"), attachmentManifest, "utf8");
  files["attachments/manifest.ndjson"] = { count: 0, sha256: digest(attachmentManifest) };

  const governanceIssues = [
    { sourceEntity: "ORGANIZATION", sourceId: "ORG-CANDIDATE", code: "ORGANIZATION_INFERRED_REVIEW_REQUIRED", severity: "REVIEW", field: "status", message: "未经治理确认不得创建正式组织。" },
    { sourceEntity: "SNAPSHOT", sourceId: "reference-fixture", code: "NOT_FINAL_V1_PRODUCTION_SNAPSHOT", severity: "BLOCKER", message: "参考包不得 APPLY 或 FULL。" },
  ];
  const governanceBody = `${governanceIssues.map((value) => JSON.stringify(value)).join("\n")}\n`;
  const governancePath = "governance/manual-review.ndjson";
  await writeFile(path.join(root, governancePath), governanceBody, "utf8");
  files[governancePath] = { count: governanceIssues.length, sha256: digest(governanceBody) };

  const snapshot = {
    sourceSystem: "ZHILIANBAO_V1",
    schemaVersion: "v1-package-reference-1",
    snapshotId: "reference-fixture",
    snapshotAt: "2026-08-31T00:00:00+08:00",
    exportedAt: "2026-08-31T00:00:00+08:00",
    isSanitized: false,
    snapshotKind: "SAMPLE",
    mappingVersion: "reference-test-1",
    sourceAdapter: "V1_REFERENCE_PACKAGE",
    sourceClassification: "REFERENCE_EXPORT_NOT_FINAL",
    applyEligible: false,
    fullRehearsalEligible: false,
    governanceIssues: { path: governancePath, ...files[governancePath] },
    files,
    entities: Object.fromEntries(LEGACY_ENTITY_TYPES.map((entityType) => [entityType, entityType === "ORGANIZATION" ? 1 : 0])),
  };
  await writeFile(path.join(root, "snapshot.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  return { root, snapshot };
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("V1 reference source safety contract", () => {
  it("makes reference provenance non-upgradable and denies apply/FULL", async () => {
    const fixture = await createGovernedReferenceSnapshot();
    const parsed = snapshotManifestSchema.parse(fixture.snapshot);
    expect(manifestAllowsApply(parsed)).toBe(false);
    expect(manifestAllowsFullRehearsal(parsed)).toBe(false);
    expect(() => snapshotManifestSchema.parse({ ...fixture.snapshot, snapshotKind: "FULL" })).toThrow();
    expect(() => snapshotManifestSchema.parse({ ...fixture.snapshot, sourceClassification: "CONTROLLED_EXPORT" })).toThrow();
  });

  it("feeds verified governance blockers into preview and suppresses inferred organizations", async () => {
    const fixture = await createGovernedReferenceSnapshot();
    const provider = new SnapshotDirectoryLegacySourceProvider(fixture.root);
    const preview = await runMigrationPreview(provider, { mode: "SAMPLE_REHEARSAL" });
    expect(preview.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "NOT_FINAL_V1_PRODUCTION_SNAPSHOT", severity: "BLOCKER" }),
      expect.objectContaining({ code: "ORGANIZATION_INFERRED_REVIEW_REQUIRED", severity: "REVIEW" }),
    ]));
    expect(preview.reconciliation.modules.find((value) => value.module === "ORGANIZATION")).toMatchObject({ sourceCount: 1, successCount: 0, failedCount: 1 });
    await expect(runMigrationPreview(provider, { mode: "FULL_REHEARSAL" })).rejects.toThrow("FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT");
  });

  it("rejects member IDs that could become path segments before the legacy copy step", () => {
    expect(assertLegacyMemberIdPathSafe(123)).toBe("123");
    expect(assertLegacyMemberIdPathSafe("成员_甲-01")).toBe("成员_甲-01");
    for (const value of ["../outside", "..\\outside", "/absolute/path", "C:\\absolute\\path", "a/b", "a\\b", ".."] ) {
      expect(() => assertLegacyMemberIdPathSafe(value)).toThrow("V1_PACKAGE_MEMBER_ID_PATH_UNSAFE");
    }
  });

  it("uses opaque attachment names and rejects target escapes", () => {
    const blobRoot = path.join(tmpdir(), "reference-blobs");
    for (const maliciousId of ["../outside", "..\\outside", "/absolute/path", "C:\\absolute\\path"]) {
      const relative = privateAttachmentRelativePath(`MEMBER-PHOTO-${maliciousId}`, ".png");
      expect(relative).toMatch(/^members\/[a-f0-9]{64}\.png$/);
      const destination = resolvePrivateAttachmentDestination(blobRoot, relative);
      expect(destination.startsWith(`${path.resolve(blobRoot)}${path.sep}`)).toBe(true);
    }
    expect(() => resolvePrivateAttachmentDestination(blobRoot, "../escape.png")).toThrow("V1_PACKAGE_ATTACHMENT_TARGET_PATH_INVALID");
    expect(() => resolvePrivateAttachmentDestination(blobRoot, "members/../escape.png")).toThrow("V1_PACKAGE_ATTACHMENT_TARGET_PATH_INVALID");
  });

  it("rejects sensitive output in a Git worktree unless it is under the dedicated ignored root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "v1-reference-git-root-"));
    temporaryRoots.push(root);
    await mkdir(path.join(root, ".git"));
    await writeFile(path.join(root, ".gitignore"), "/.migration-work\n", "utf8");
    await expect(assertPrivateMigrationOutput(path.join(root, "prepared"))).rejects.toThrow("V1_PACKAGE_OUTPUT_INSIDE_TRACKED_GIT_PATH");
    await expect(assertPrivateMigrationOutput(path.join(root, ".migration-work", "prepared"))).resolves.toBeUndefined();

    const unsafeRoot = await mkdtemp(path.join(tmpdir(), "v1-reference-unignored-root-"));
    temporaryRoots.push(unsafeRoot);
    await mkdir(path.join(unsafeRoot, ".git"));
    await writeFile(path.join(unsafeRoot, ".gitignore"), "node_modules\n", "utf8");
    await expect(assertPrivateMigrationOutput(path.join(unsafeRoot, ".migration-work", "prepared"))).rejects.toThrow("V1_PACKAGE_OUTPUT_GIT_IGNORE_UNVERIFIED");
  });
});
