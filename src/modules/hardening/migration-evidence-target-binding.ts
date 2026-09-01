import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, open, type FileHandle } from "node:fs/promises";
import {
  MIGRATION_EVIDENCE_MODULES,
  type EvidenceValidation,
} from "./release-readiness-core.ts";
import {
  validateMigrationEvidence as validateMigrationEvidenceBase,
  type ApprovedMigrationTarget,
} from "./migration-evidence.ts";

type EvidenceFileHandle = Pick<FileHandle, "close" | "read" | "stat">;
type LoadedPointer = { bytes: Uint8Array; digest: string };

const MAX_BINDING_DOCUMENT_BYTES = 4 * 1024 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const NON_ATTACHMENT_MODULES = MIGRATION_EVIDENCE_MODULES.filter((module) => module !== "ATTACHMENT");

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
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

function sameFileIdentity(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function immutableUrnDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^urn:sha256:([a-f0-9]{64})$/i.exec(value.trim());
  return match ? match[1].toLowerCase() : null;
}

async function readImmutableLocalPointer(pointer: Record<string, unknown>): Promise<LoadedPointer | null> {
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
      || initial.size > MAX_BINDING_DOCUMENT_BYTES) return null;

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const capacity = Math.min(READ_CHUNK_BYTES, MAX_BINDING_DOCUMENT_BYTES + 1 - total);
      if (capacity <= 0) return null;
      const buffer = Buffer.allocUnsafe(capacity);
      const { bytesRead } = await handle.read(buffer, 0, capacity, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > MAX_BINDING_DOCUMENT_BYTES) return null;
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

function targetStateDigest(input: {
  moduleCounts: Record<string, unknown>;
  legacyMapCountsByModule: Record<string, unknown>;
  legacyMapCount: number;
  danglingLegacyMapCount: number;
  attachmentCount: number;
}): string {
  return createHash("sha256").update(JSON.stringify(canonicalValue(input))).digest("hex");
}

export function validateMigrationTargetStateBinding(modulesValue: unknown, targetStateValue: unknown): boolean {
  if (!Array.isArray(modulesValue)) return false;
  const modules = modulesValue.map(objectValue);
  const state = objectValue(targetStateValue);
  const moduleCounts = objectValue(state?.moduleCounts);
  const legacyMapCountsByModule = objectValue(state?.legacyMapCountsByModule);
  if (modules.some((module) => !module) || !state || !moduleCounts || !legacyMapCountsByModule
    || !exactStringSet((modules as Record<string, unknown>[]).map((module) => String(module.module)), MIGRATION_EVIDENCE_MODULES)
    || !exactStringSet(Object.keys(moduleCounts), MIGRATION_EVIDENCE_MODULES)
    || !exactStringSet(Object.keys(legacyMapCountsByModule), NON_ATTACHMENT_MODULES)
    || !Object.values(moduleCounts).every(nonNegativeInteger)
    || !Object.values(legacyMapCountsByModule).every(nonNegativeInteger)
    || !nonNegativeInteger(state.recordCount) || !nonNegativeInteger(state.attachmentCount)
    || !nonNegativeInteger(state.legacyMapCount) || state.danglingLegacyMapCount !== 0
    || !sha256Digest(state.sha256)) return false;

  let expectedLegacyMapCount = 0;
  for (const moduleName of MIGRATION_EVIDENCE_MODULES) {
    const module = (modules as Record<string, unknown>[]).find((candidate) => candidate.module === moduleName);
    if (!module || !nonNegativeInteger(module.successCount) || !nonNegativeInteger(module.mergedCount)
      || !nonNegativeInteger(module.skippedCount) || !nonNegativeInteger(module.attachmentSuccessCount)) return false;
    const distinctTargetCount = moduleCounts[moduleName];
    if (!nonNegativeInteger(distinctTargetCount)) return false;

    if (moduleName === "ATTACHMENT") {
      if (distinctTargetCount !== module.attachmentSuccessCount) return false;
      continue;
    }

    const expectedMappedSources = module.successCount + module.mergedCount + module.skippedCount;
    if (legacyMapCountsByModule[moduleName] !== expectedMappedSources) return false;
    expectedLegacyMapCount += expectedMappedSources;
    if (expectedMappedSources === 0 ? distinctTargetCount !== 0 : distinctTargetCount < 1 || distinctTargetCount > expectedMappedSources) return false;
  }

  const recordCount = Object.values(moduleCounts).reduce<number>((sum, count) => sum + (count as number), 0);
  if (state.recordCount !== recordCount || state.attachmentCount !== moduleCounts.ATTACHMENT
    || state.legacyMapCount !== expectedLegacyMapCount) return false;

  return state.sha256 === targetStateDigest({
    moduleCounts,
    legacyMapCountsByModule,
    legacyMapCount: state.legacyMapCount,
    danglingLegacyMapCount: state.danglingLegacyMapCount as number,
    attachmentCount: state.attachmentCount,
  });
}

function failure(evidenceRef?: string): EvidenceValidation {
  return { status: "FAIL", errorCode: "MIGRATION_TARGET_STATE_BINDING_INVALID", evidenceRef };
}

export async function validateMigrationEvidence(
  raw: string | undefined,
  candidateSha: string,
  expected: ApprovedMigrationTarget = {},
): Promise<EvidenceValidation> {
  const base = await validateMigrationEvidenceBase(raw, candidateSha, expected);
  if (base.status !== "PASS") return base;

  let outerPointer: Record<string, unknown> | null = null;
  try { outerPointer = objectValue(JSON.parse(raw ?? "") as unknown); } catch { outerPointer = null; }
  const loadedOuter = outerPointer ? await readImmutableLocalPointer(outerPointer) : null;
  const evidence = loadedOuter ? parseJsonObject(loadedOuter.bytes) : null;
  const details = objectValue(evidence?.details);
  const executionEvidence = objectValue(details?.executionEvidence);
  if (!details || !executionEvidence) return failure(base.evidenceRef);

  const applyPointer = objectValue(executionEvidence.apply);
  const rerunPointer = objectValue(executionEvidence.rerun);
  const [loadedApply, loadedRerun] = await Promise.all([
    applyPointer ? readImmutableLocalPointer(applyPointer) : Promise.resolve(null),
    rerunPointer ? readImmutableLocalPointer(rerunPointer) : Promise.resolve(null),
  ]);
  const apply = loadedApply ? parseJsonObject(loadedApply.bytes) : null;
  const rerun = loadedRerun ? parseJsonObject(loadedRerun.bytes) : null;
  if (!apply || !rerun
    || !validateMigrationTargetStateBinding(apply.modules, apply.targetState)
    || !validateMigrationTargetStateBinding(rerun.modules, rerun.targetState)
    || !sameCanonical(apply.targetState, rerun.targetState)) return failure(base.evidenceRef);

  return base;
}
