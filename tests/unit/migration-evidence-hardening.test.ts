import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MIGRATION_EVIDENCE_MANIFEST_PATHS,
  MIGRATION_EVIDENCE_MODULES,
} from "@/modules/hardening/release-readiness-core";
import {
  validateMigrationEvidence,
  type ApprovedMigrationTarget,
} from "@/modules/hardening/migration-evidence";

const candidateSha = "1".repeat(40);
const verifiedAt = "2026-09-01T00:00:00.000Z";
const approvedTarget: ApprovedMigrationTarget = {
  environment: "TEST",
  databaseId: "v2-migration-rehearsal-20260901",
};
const temporaryDirectories: string[] = [];

type Pointer = { reference: string; sourcePath: string };
type ManifestFile = { path: string; count: number; sha256: string };
type ModuleRow = {
  module: string;
  sourceCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  mergedCount: number;
  reviewCount: number;
  attachmentCount: number;
  attachmentSuccessCount: number;
  attachmentIssueCount: number;
};
type ExecutionArtifact = Record<string, unknown> & {
  executionId: string;
  batchId: string | null;
  modules: ModuleRow[];
  attachmentInventory: Record<string, unknown>;
  targetState: Record<string, unknown>;
  writeSummary: Record<string, unknown>;
};
type EvidenceDraft = {
  root: string;
  details: Record<string, unknown> & {
    migrationRunId: string;
    rerunRunId: string;
    snapshotFiles: Array<{ path: string; pointer: Pointer }>;
    modules: ModuleRow[];
    attachmentInventory: Record<string, unknown>;
  };
  executionArtifacts: {
    dryRun: ExecutionArtifact;
    apply: ExecutionArtifact;
    rerun: ExecutionArtifact;
  };
  snapshotPaths: Record<string, string>;
};

async function immutableFile(path: string, content: string): Promise<Pointer> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  const digest = createHash("sha256").update(content).digest("hex");
  return { reference: `urn:sha256:${digest}`, sourcePath: path };
}

function digestFromPointer(pointer: Pointer): string {
  return pointer.reference.slice("urn:sha256:".length);
}

function moduleRows(manifestFiles: ManifestFile[], phase: "DRY_RUN" | "APPLY" | "RERUN"): ModuleRow[] {
  return MIGRATION_EVIDENCE_MODULES.map((module, index) => {
    const sourceCount = manifestFiles[index].count;
    return {
      module,
      sourceCount,
      successCount: phase === "RERUN" ? 0 : sourceCount,
      failedCount: 0,
      skippedCount: phase === "RERUN" ? sourceCount : 0,
      mergedCount: 0,
      reviewCount: 0,
      attachmentCount: module === "ATTACHMENT" ? sourceCount : 0,
      attachmentSuccessCount: module === "ATTACHMENT" ? sourceCount : 0,
      attachmentIssueCount: 0,
    };
  });
}

function attachmentInventory(attachmentFile: ManifestFile, phase: "DRY_RUN" | "APPLY" | "RERUN") {
  return {
    manifestPath: attachmentFile.path,
    manifestSha256: attachmentFile.sha256,
    sourceCount: attachmentFile.count,
    copiedCount: phase === "APPLY" ? attachmentFile.count : 0,
    hashVerifiedCount: attachmentFile.count,
    issueCount: 0,
    validationPassed: true,
  };
}

function targetState(manifestFiles: ManifestFile[]) {
  const moduleCounts = Object.fromEntries(MIGRATION_EVIDENCE_MODULES.map((module, index) => [module, manifestFiles[index].count]));
  const recordCount = Object.values(moduleCounts).reduce((sum, count) => sum + count, 0);
  return {
    moduleCounts,
    recordCount,
    attachmentCount: moduleCounts.ATTACHMENT,
    legacyMapCount: recordCount,
    sha256: createHash("sha256").update(JSON.stringify(moduleCounts)).digest("hex"),
  };
}

async function buildDraft(): Promise<EvidenceDraft> {
  const root = await mkdtemp(join(tmpdir(), "zlb-migration-evidence-"));
  temporaryDirectories.push(root);
  const snapshotFiles: Array<{ path: string; pointer: Pointer }> = [];
  const snapshotPaths: Record<string, string> = {};
  const manifestFiles: ManifestFile[] = [];

  for (const path of MIGRATION_EVIDENCE_MANIFEST_PATHS) {
    const count = path === "attachments/manifest.ndjson" ? 3 : 1;
    const content = Array.from({ length: count }, (_, index) => JSON.stringify({ id: `${path}:${index + 1}` })).join("\n") + "\n";
    const sourcePath = join(root, "snapshot", path);
    const pointer = await immutableFile(sourcePath, content);
    snapshotFiles.push({ path, pointer });
    snapshotPaths[path] = sourcePath;
    manifestFiles.push({ path, count, sha256: digestFromPointer(pointer) });
  }

  const snapshotId = "v1-full-snapshot-20260901";
  const manifestContent = JSON.stringify({
    sourceSystem: "ZHILIANBAO_V1",
    schemaVersion: "v1-full-1",
    snapshotId,
    snapshotAt: "2026-09-01T00:00:00.000Z",
    exportedAt: "2026-09-01T00:10:00.000Z",
    isSanitized: false,
    snapshotKind: "FULL",
    mappingVersion: "m3-006-v1",
    files: Object.fromEntries(manifestFiles.map(({ path, count, sha256 }) => [path, { count, sha256 }])),
    entities: Object.fromEntries(MIGRATION_EVIDENCE_MODULES
      .filter((module) => module !== "ATTACHMENT")
      .map((module, index) => [module, manifestFiles[index].count])),
  });
  const snapshotManifest = await immutableFile(join(root, "snapshot", "snapshot.json"), manifestContent);
  const manifestSha256 = digestFromPointer(snapshotManifest);
  const applyModules = moduleRows(manifestFiles, "APPLY");
  const applyInventory = attachmentInventory(manifestFiles.at(-1)!, "APPLY");
  const finalState = targetState(manifestFiles);

  const commonExecution = {
    schemaVersion: "v1-migration-execution-v1",
    candidateSha,
    sourceSnapshotIdentity: snapshotId,
    manifestSha256,
    targetEnvironment: "TEST",
    targetMigrationDatabase: approvedTarget.databaseId,
    status: "PASS",
    unresolvedBlockerCount: 0,
    unresolvedReviewCount: 0,
    reconciliationPassed: true,
  };

  const executionArtifacts = {
    dryRun: {
      ...commonExecution,
      phase: "DRY_RUN",
      executionId: "dry-run-full-20260901",
      batchId: null,
      modules: moduleRows(manifestFiles, "DRY_RUN"),
      attachmentInventory: attachmentInventory(manifestFiles.at(-1)!, "DRY_RUN"),
      targetState: structuredClone(finalState),
      writeSummary: { createdCount: 0, updatedCount: 0, deletedCount: 0 },
    },
    apply: {
      ...commonExecution,
      phase: "APPLY",
      executionId: "apply-run-full-20260901",
      batchId: "apply-batch-full-20260901",
      modules: structuredClone(applyModules),
      attachmentInventory: structuredClone(applyInventory),
      targetState: structuredClone(finalState),
      writeSummary: { createdCount: finalState.recordCount, updatedCount: 0, deletedCount: 0 },
    },
    rerun: {
      ...commonExecution,
      phase: "RERUN",
      executionId: "rerun-run-full-20260901",
      batchId: "rerun-batch-full-20260901",
      idempotencyPassed: true,
      modules: moduleRows(manifestFiles, "RERUN"),
      attachmentInventory: attachmentInventory(manifestFiles.at(-1)!, "RERUN"),
      targetState: structuredClone(finalState),
      writeSummary: { createdCount: 0, updatedCount: 0, deletedCount: 0 },
    },
  } satisfies EvidenceDraft["executionArtifacts"];

  return {
    root,
    details: {
      sourceSnapshotIdentity: snapshotId,
      snapshotKind: "FULL",
      rehearsalMode: "FULL_REHEARSAL",
      fullRehearsalStatus: "COMPLETED",
      snapshotManifest,
      manifestSha256,
      manifestFiles,
      snapshotFiles,
      attachmentInventory: structuredClone(applyInventory),
      targetMigrationEnvironment: "TEST",
      targetMigrationDatabase: approvedTarget.databaseId,
      dryRunId: executionArtifacts.dryRun.executionId,
      migrationBatchId: executionArtifacts.apply.batchId,
      migrationRunId: executionArtifacts.apply.executionId,
      rerunBatchId: executionArtifacts.rerun.batchId,
      rerunRunId: executionArtifacts.rerun.executionId,
      unresolvedBlockerCount: 0,
      unresolvedReviewCount: 0,
      modules: structuredClone(applyModules),
      dryRunPassed: true,
      applyPassed: true,
      rerunPassed: true,
      reconciliationPassed: true,
    },
    executionArtifacts,
    snapshotPaths,
  };
}

async function seal(draft: EvidenceDraft): Promise<string> {
  const executionEvidence = {
    dryRun: await immutableFile(join(draft.root, "executions", "dry-run.json"), JSON.stringify(draft.executionArtifacts.dryRun)),
    apply: await immutableFile(join(draft.root, "executions", "apply.json"), JSON.stringify(draft.executionArtifacts.apply)),
    rerun: await immutableFile(join(draft.root, "executions", "rerun.json"), JSON.stringify(draft.executionArtifacts.rerun)),
  };
  draft.details.executionEvidence = executionEvidence;
  const outer = JSON.stringify({
    category: "migration",
    candidateSha,
    environment: "TEST",
    status: "PASS",
    verifiedAt,
    details: draft.details,
  });
  const pointer = await immutableFile(join(draft.root, "migration-evidence.json"), outer);
  return JSON.stringify(pointer);
}

afterEach(async () => {
  delete process.env.V1_MIGRATION_APPROVED_TARGET_ENVIRONMENT;
  delete process.env.V1_MIGRATION_APPROVED_TARGET_DATABASE;
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("FULL V1 migration evidence hardening", () => {
  it("accepts actual snapshot bytes and separately bound dry-run, apply, and idempotent-rerun artifacts", async () => {
    const draft = await buildDraft();
    await expect(validateMigrationEvidence(await seal(draft), candidateSha, approvedTarget)).resolves.toMatchObject({ status: "PASS" });
  });

  it("fails closed without an operator-injected approved TEST migration database", async () => {
    const draft = await buildDraft();
    await expect(validateMigrationEvidence(await seal(draft), candidateSha)).resolves.toMatchObject({
      status: "FAIL",
      errorCode: "MIGRATION_APPROVED_TARGET_IDENTITY_MISSING",
    });
  });

  it("rejects evidence targeting a database other than the approved isolated TEST migration database", async () => {
    const draft = await buildDraft();
    await expect(validateMigrationEvidence(await seal(draft), candidateSha, {
      environment: "TEST",
      databaseId: "daily-shared-test",
    })).resolves.toMatchObject({ status: "FAIL", errorCode: "MIGRATION_TARGET_IDENTITY_MISMATCH" });
  });

  it("normalizes execution identities before uniqueness checks and rejects whitespace reuse", async () => {
    const draft = await buildDraft();
    draft.details.rerunRunId = ` ${draft.details.migrationRunId} `;
    await expect(validateMigrationEvidence(await seal(draft), candidateSha, approvedTarget)).resolves.toMatchObject({
      status: "FAIL",
      errorCode: "MIGRATION_EXECUTION_ID_INVALID",
    });
  });

  it("rejects a missing snapshot-file pointer even when the manifest and copied metadata still claim completeness", async () => {
    const draft = await buildDraft();
    draft.details.snapshotFiles.pop();
    await expect(validateMigrationEvidence(await seal(draft), candidateSha, approvedTarget)).resolves.toMatchObject({
      status: "FAIL",
      errorCode: "MIGRATION_SNAPSHOT_FILE_EVIDENCE_INVALID",
    });
  });

  it("recomputes snapshot-file bytes and rejects post-seal tampering", async () => {
    const draft = await buildDraft();
    const raw = await seal(draft);
    const path = MIGRATION_EVIDENCE_MANIFEST_PATHS[0];
    await writeFile(draft.snapshotPaths[path], `${JSON.stringify({ id: "tampered" })}\n`);
    await expect(validateMigrationEvidence(raw, candidateSha, approvedTarget)).resolves.toMatchObject({
      status: "FAIL",
      errorCode: "MIGRATION_SNAPSHOT_FILE_EVIDENCE_INVALID",
    });
  });

  it("binds the apply artifact to the declared execution identity", async () => {
    const draft = await buildDraft();
    draft.executionArtifacts.apply.executionId = "different-apply-run";
    await expect(validateMigrationEvidence(await seal(draft), candidateSha, approvedTarget)).resolves.toMatchObject({
      status: "FAIL",
      errorCode: "MIGRATION_EXECUTION_EVIDENCE_INVALID",
    });
  });

  it("rejects top-level reconciliation copied from another run", async () => {
    const draft = await buildDraft();
    draft.executionArtifacts.apply.modules[0].successCount = 0;
    draft.executionArtifacts.apply.modules[0].skippedCount = draft.executionArtifacts.apply.modules[0].sourceCount;
    await expect(validateMigrationEvidence(await seal(draft), candidateSha, approvedTarget)).resolves.toMatchObject({
      status: "FAIL",
      errorCode: "MIGRATION_APPLY_RESULT_BINDING_INVALID",
    });
  });

  it("rejects a purported idempotent rerun that writes target rows", async () => {
    const draft = await buildDraft();
    draft.executionArtifacts.rerun.writeSummary.createdCount = 1;
    await expect(validateMigrationEvidence(await seal(draft), candidateSha, approvedTarget)).resolves.toMatchObject({
      status: "FAIL",
      errorCode: "MIGRATION_EXECUTION_EVIDENCE_INVALID",
    });
  });

  it("rejects a rerun whose final target fingerprint differs from the apply result", async () => {
    const draft = await buildDraft();
    draft.executionArtifacts.rerun.targetState.legacyMapCount = Number(draft.executionArtifacts.rerun.targetState.legacyMapCount) + 1;
    await expect(validateMigrationEvidence(await seal(draft), candidateSha, approvedTarget)).resolves.toMatchObject({
      status: "FAIL",
      errorCode: "MIGRATION_RERUN_NOT_IDEMPOTENT",
    });
  });
});
