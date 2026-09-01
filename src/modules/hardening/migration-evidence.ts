import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import {
  MIGRATION_EVIDENCE_MANIFEST_PATHS,
  MIGRATION_EVIDENCE_MODULES,
  validateMigrationEvidence as validateMigrationEvidenceCore,
  type EvidenceValidation,
} from "./release-readiness-core.ts";

export type ApprovedMigrationTarget = {
  environment?: string;
  databaseId?: string;
};

type EvidenceFileHandle = Pick<FileHandle, "close" | "read" | "stat">;
type LoadedPointer = { bytes: Uint8Array; digest: string };
type ExecutionPhase = "DRY_RUN" | "APPLY" | "RERUN";
type SnapshotManifest = {
  snapshotId: string;
  snapshotKind: "FULL";
  files: Record<string, { count: number; sha256: string }>;
};
type ExecutionResult = {
  artifact: Record<string, unknown>;
  modules: unknown[];
  attachmentInventory: Record<string, unknown>;
  targetState: Record<string, unknown>;
  writeSummary: Record<string, unknown>;
};

const MAX_MIGRATION_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_MIGRATION_SNAPSHOT_FILE_BYTES = 128 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function exactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && new Set(actual).size === expected.length && expected.every((value) => actual.includes(value));
}

function normalizedIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= 191 && value === normalized ? normalized : null;
}

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function immutableUrnDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^urn:sha256:([a-f0-9]{64})$/i.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

async function readImmutableLocalPointer(pointer: Record<string, unknown>, maximumBytes: number): Promise<LoadedPointer | null> {
  const digest = immutableUrnDigest(pointer.reference);
  const sourcePath = typeof pointer.sourcePath === "string" ? pointer.sourcePath.trim() : "";
  if (!digest || !sourcePath) return null;

  let handle: EvidenceFileHandle | undefined;
  try {
    const pathInfo = await lstat(sourcePath);
    if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) return null;
    handle = await open(sourcePath, "r");
    const initial = await handle.stat();
    const openedPathInfo = await lstat(sourcePath);
    if (!initial.isFile() || openedPathInfo.isSymbolicLink() || !openedPathInfo.isFile()
      || !sameFileIdentity(pathInfo, initial) || !sameFileIdentity(initial, openedPathInfo)
      || initial.size > maximumBytes) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const capacity = Math.min(READ_CHUNK_BYTES, maximumBytes + 1 - total);
      if (capacity <= 0) return null;
      const buffer = Buffer.allocUnsafe(capacity);
      const { bytesRead } = await handle.read(buffer, 0, capacity, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maximumBytes) return null;
      chunks.push(new Uint8Array(buffer.buffer, buffer.byteOffset, bytesRead));
    }

    const final = await handle.stat();
    if (!sameFileIdentity(initial, final) || initial.size !== final.size || initial.mtimeMs !== final.mtimeMs) return null;
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return createHash("sha256").update(bytes).digest("hex") === digest ? { bytes, digest } : null;
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function parseJsonObject(bytes: Uint8Array): Record<string, unknown> | null {
  try {
    return objectValue(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown);
  } catch {
    return null;
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  const object = objectValue(value);
  if (!object) return value;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalValue(object[key])]));
}

function sameCanonical(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalValue(left)) === JSON.stringify(canonicalValue(right));
}

function countNdjsonRecords(bytes: Uint8Array): number | null {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  const records = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  try {
    for (const line of records) {
      if (!objectValue(JSON.parse(line) as unknown)) return null;
    }
  } catch {
    return null;
  }
  return records.length;
}

function parseSnapshotManifest(bytes: Uint8Array): SnapshotManifest | null {
  const manifest = parseJsonObject(bytes);
  const files = objectValue(manifest?.files);
  if (!manifest || manifest.snapshotKind !== "FULL" || !nonEmpty(manifest.snapshotId) || !files
    || !exactStringSet(Object.keys(files), MIGRATION_EVIDENCE_MANIFEST_PATHS)) return null;
  for (const path of MIGRATION_EVIDENCE_MANIFEST_PATHS) {
    const file = objectValue(files[path]);
    if (!file || !nonNegativeInteger(file.count) || !sha256Digest(file.sha256)) return null;
  }
  return manifest as unknown as SnapshotManifest;
}

function validateModules(value: unknown, manifest: SnapshotManifest): unknown[] | null {
  if (!Array.isArray(value)) return null;
  const modules = value.map(objectValue);
  if (modules.some((module) => !module)) return null;
  const names: string[] = [];
  for (const moduleEntry of modules as Record<string, unknown>[]) {
    if (!nonEmpty(moduleEntry.module)) return null;
    names.push(moduleEntry.module);
    const countFields = [
      "sourceCount", "successCount", "failedCount", "skippedCount", "mergedCount", "reviewCount",
      "attachmentCount", "attachmentSuccessCount", "attachmentIssueCount",
    ] as const;
    if (!countFields.every((field) => nonNegativeInteger(moduleEntry[field]))) return null;
    const sourceEquation = moduleEntry.sourceCount === (moduleEntry.successCount as number)
      + (moduleEntry.failedCount as number) + (moduleEntry.skippedCount as number)
      + (moduleEntry.mergedCount as number) + (moduleEntry.reviewCount as number);
    const attachmentEquation = moduleEntry.attachmentCount === (moduleEntry.attachmentSuccessCount as number)
      + (moduleEntry.attachmentIssueCount as number);
    if (!sourceEquation || !attachmentEquation || moduleEntry.failedCount !== 0
      || moduleEntry.reviewCount !== 0 || moduleEntry.attachmentIssueCount !== 0) return null;
  }
  if (!exactStringSet(names, MIGRATION_EVIDENCE_MODULES)) return null;
  for (let index = 0; index < MIGRATION_EVIDENCE_MODULES.length; index += 1) {
    const moduleName = MIGRATION_EVIDENCE_MODULES[index];
    const path = MIGRATION_EVIDENCE_MANIFEST_PATHS[index];
    const moduleEntry = (modules as Record<string, unknown>[]).find((candidate) => candidate.module === moduleName);
    if (!moduleEntry || moduleEntry.sourceCount !== manifest.files[path].count) return null;
  }
  return value;
}

function validateAttachmentInventory(
  value: unknown,
  manifest: SnapshotManifest,
  phase: ExecutionPhase,
  modules: unknown[],
): Record<string, unknown> | null {
  const inventory = objectValue(value);
  const attachmentManifest = manifest.files["attachments/manifest.ndjson"];
  if (!inventory || inventory.manifestPath !== "attachments/manifest.ndjson"
    || inventory.manifestSha256 !== attachmentManifest.sha256
    || inventory.sourceCount !== attachmentManifest.count
    || !nonNegativeInteger(inventory.copiedCount) || inventory.hashVerifiedCount !== attachmentManifest.count
    || inventory.issueCount !== 0 || inventory.validationPassed !== true) return null;
  const expectedCopied = phase === "APPLY" ? attachmentManifest.count : 0;
  if (inventory.copiedCount !== expectedCopied) return null;

  const moduleObjects = modules.map(objectValue) as Record<string, unknown>[];
  const attachmentCount = moduleObjects.reduce((total, moduleEntry) => total + (moduleEntry.attachmentCount as number), 0);
  const attachmentSuccessCount = moduleObjects.reduce((total, moduleEntry) => total + (moduleEntry.attachmentSuccessCount as number), 0);
  return attachmentCount === attachmentManifest.count && attachmentSuccessCount === attachmentManifest.count ? inventory : null;
}

function validateTargetState(value: unknown, manifest: SnapshotManifest): Record<string, unknown> | null {
  const state = objectValue(value);
  const moduleCounts = objectValue(state?.moduleCounts);
  if (!state || !moduleCounts || !exactStringSet(Object.keys(moduleCounts), MIGRATION_EVIDENCE_MODULES)
    || !Object.values(moduleCounts).every(nonNegativeInteger) || !nonNegativeInteger(state.recordCount)
    || !nonNegativeInteger(state.attachmentCount) || !nonNegativeInteger(state.legacyMapCount)
    || !sha256Digest(state.sha256)) return null;
  const total = Object.values(moduleCounts).reduce<number>((sum, count) => sum + (count as number), 0);
  return state.recordCount === total
    && state.attachmentCount === moduleCounts.ATTACHMENT
    && state.attachmentCount === manifest.files["attachments/manifest.ndjson"].count
    ? state
    : null;
}

function validateWriteSummary(value: unknown, phase: ExecutionPhase): Record<string, unknown> | null {
  const summary = objectValue(value);
  if (!summary || !nonNegativeInteger(summary.createdCount) || !nonNegativeInteger(summary.updatedCount)
    || !nonNegativeInteger(summary.deletedCount)) return null;
  if ((phase === "DRY_RUN" || phase === "RERUN")
    && (summary.createdCount !== 0 || summary.updatedCount !== 0 || summary.deletedCount !== 0)) return null;
  return summary;
}

async function loadExecution(
  pointerValue: unknown,
  phase: ExecutionPhase,
  expectedExecutionId: string,
  expectedBatchId: string | null,
  candidateSha: string,
  sourceSnapshotIdentity: string,
  manifestDigest: string,
  targetDatabase: string,
  manifest: SnapshotManifest,
): Promise<ExecutionResult | null> {
  const pointer = objectValue(pointerValue);
  const loaded = pointer ? await readImmutableLocalPointer(pointer, MAX_MIGRATION_DOCUMENT_BYTES) : null;
  const artifact = loaded ? parseJsonObject(loaded.bytes) : null;
  if (!artifact || artifact.schemaVersion !== "v1-migration-execution-v1" || artifact.phase !== phase
    || normalizedIdentifier(artifact.executionId) !== expectedExecutionId
    || artifact.candidateSha !== candidateSha || artifact.sourceSnapshotIdentity !== sourceSnapshotIdentity
    || artifact.manifestSha256 !== manifestDigest || artifact.targetEnvironment !== "TEST"
    || artifact.targetMigrationDatabase !== targetDatabase || artifact.status !== "PASS"
    || artifact.unresolvedBlockerCount !== 0 || artifact.unresolvedReviewCount !== 0
    || artifact.reconciliationPassed !== true) return null;
  if (expectedBatchId === null ? artifact.batchId !== null : normalizedIdentifier(artifact.batchId) !== expectedBatchId) return null;
  if (phase === "RERUN" && artifact.idempotencyPassed !== true) return null;

  const modules = validateModules(artifact.modules, manifest);
  const inventory = modules ? validateAttachmentInventory(artifact.attachmentInventory, manifest, phase, modules) : null;
  const targetState = validateTargetState(artifact.targetState, manifest);
  const writeSummary = validateWriteSummary(artifact.writeSummary, phase);
  return modules && inventory && targetState && writeSummary
    ? { artifact, modules, attachmentInventory: inventory, targetState, writeSummary }
    : null;
}

function failure(errorCode: string, evidenceRef?: string): EvidenceValidation {
  return { status: "FAIL", errorCode, evidenceRef };
}

export async function validateMigrationEvidence(
  raw: string | undefined,
  candidateSha: string,
  expected: ApprovedMigrationTarget = {},
): Promise<EvidenceValidation> {
  const coreValidation = await validateMigrationEvidenceCore(raw, candidateSha);
  if (coreValidation.status !== "PASS") return coreValidation;

  const approvedEnvironment = (expected.environment ?? process.env.V1_MIGRATION_APPROVED_TARGET_ENVIRONMENT)?.trim().toUpperCase();
  const approvedDatabase = (expected.databaseId ?? process.env.V1_MIGRATION_APPROVED_TARGET_DATABASE)?.trim();
  if (approvedEnvironment !== "TEST" || !approvedDatabase) {
    return failure("MIGRATION_APPROVED_TARGET_IDENTITY_MISSING", coreValidation.evidenceRef);
  }

  let outerPointer: Record<string, unknown> | null = null;
  try { outerPointer = objectValue(JSON.parse(raw ?? "") as unknown); } catch { outerPointer = null; }
  const loadedOuter = outerPointer ? await readImmutableLocalPointer(outerPointer, MAX_MIGRATION_DOCUMENT_BYTES) : null;
  const evidence = loadedOuter ? parseJsonObject(loadedOuter.bytes) : null;
  const details = objectValue(evidence?.details);
  if (!evidence || evidence.category !== "migration" || evidence.candidateSha !== candidateSha
    || evidence.environment !== "TEST" || evidence.status !== "PASS" || !details) {
    return failure("MIGRATION_EVIDENCE_CONTENT_INVALID", coreValidation.evidenceRef);
  }

  if (details.targetMigrationEnvironment !== approvedEnvironment
    || details.targetMigrationDatabase !== approvedDatabase) {
    return failure("MIGRATION_TARGET_IDENTITY_MISMATCH", coreValidation.evidenceRef);
  }

  const identityFields = ["dryRunId", "migrationBatchId", "migrationRunId", "rerunBatchId", "rerunRunId"] as const;
  const normalizedIdentities = identityFields.map((field) => normalizedIdentifier(details[field]));
  if (normalizedIdentities.some((value) => !value)
    || new Set(normalizedIdentities as string[]).size !== identityFields.length) {
    return failure("MIGRATION_EXECUTION_ID_INVALID", coreValidation.evidenceRef);
  }
  const [dryRunId, migrationBatchId, migrationRunId, rerunBatchId, rerunRunId] = normalizedIdentities as string[];

  const manifestPointer = objectValue(details.snapshotManifest);
  const loadedManifest = manifestPointer ? await readImmutableLocalPointer(manifestPointer, MAX_MIGRATION_DOCUMENT_BYTES) : null;
  const manifest = loadedManifest ? parseSnapshotManifest(loadedManifest.bytes) : null;
  if (!loadedManifest || !manifest || manifest.snapshotId !== details.sourceSnapshotIdentity
    || loadedManifest.digest !== details.manifestSha256) {
    return failure("MIGRATION_SNAPSHOT_MANIFEST_INVALID", coreValidation.evidenceRef);
  }

  if (!Array.isArray(details.snapshotFiles)) {
    return failure("MIGRATION_SNAPSHOT_FILE_EVIDENCE_INVALID", coreValidation.evidenceRef);
  }
  const snapshotFiles = details.snapshotFiles.map(objectValue);
  if (snapshotFiles.some((file) => !file)) {
    return failure("MIGRATION_SNAPSHOT_FILE_EVIDENCE_INVALID", coreValidation.evidenceRef);
  }
  const snapshotPaths = (snapshotFiles as Record<string, unknown>[]).map((file) => file.path).filter((path): path is string => typeof path === "string");
  if (!exactStringSet(snapshotPaths, MIGRATION_EVIDENCE_MANIFEST_PATHS)) {
    return failure("MIGRATION_SNAPSHOT_FILE_EVIDENCE_INVALID", coreValidation.evidenceRef);
  }
  for (const file of snapshotFiles as Record<string, unknown>[]) {
    const path = file.path as string;
    const pointer = objectValue(file.pointer);
    const loaded = pointer ? await readImmutableLocalPointer(pointer, MAX_MIGRATION_SNAPSHOT_FILE_BYTES) : null;
    const count = loaded ? countNdjsonRecords(loaded.bytes) : null;
    if (!loaded || loaded.digest !== manifest.files[path].sha256 || count !== manifest.files[path].count) {
      return failure("MIGRATION_SNAPSHOT_FILE_EVIDENCE_INVALID", coreValidation.evidenceRef);
    }
  }

  const executionEvidence = objectValue(details.executionEvidence);
  if (!executionEvidence || !exactStringSet(Object.keys(executionEvidence), ["dryRun", "apply", "rerun"])) {
    return failure("MIGRATION_EXECUTION_EVIDENCE_INVALID", coreValidation.evidenceRef);
  }

  const shared = [candidateSha, details.sourceSnapshotIdentity as string, loadedManifest.digest, approvedDatabase, manifest] as const;
  const dryRun = await loadExecution(executionEvidence.dryRun, "DRY_RUN", dryRunId, null, ...shared);
  const apply = await loadExecution(executionEvidence.apply, "APPLY", migrationRunId, migrationBatchId, ...shared);
  const rerun = await loadExecution(executionEvidence.rerun, "RERUN", rerunRunId, rerunBatchId, ...shared);
  if (!dryRun || !apply || !rerun) {
    return failure("MIGRATION_EXECUTION_EVIDENCE_INVALID", coreValidation.evidenceRef);
  }

  if (!sameCanonical(apply.modules, details.modules)
    || !sameCanonical(apply.attachmentInventory, details.attachmentInventory)) {
    return failure("MIGRATION_APPLY_RESULT_BINDING_INVALID", coreValidation.evidenceRef);
  }
  if (!sameCanonical(apply.targetState, rerun.targetState)) {
    return failure("MIGRATION_RERUN_NOT_IDEMPOTENT", coreValidation.evidenceRef);
  }

  return coreValidation;
}
