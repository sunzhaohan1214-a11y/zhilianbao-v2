import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { LEGACY_ENTITY_TYPES } from "./types";

export const MIGRATION_TARGET_STATE_SCHEMA_VERSION = "v1-migration-target-state-v1" as const;
export const MIGRATION_TARGET_STATE_MODULES = [...LEGACY_ENTITY_TYPES, "ATTACHMENT"] as const;

type StateMapping = { sourceEntity: string; sourceId: string; targetEntity: string; targetId: string };
type UnmappedSkip = { sourceEntity: string; sourceId: string };
type AttachmentState = { sourceAttachmentKey: string; targetAttachmentId: string; targetSha256: string };

export type MigrationTargetStateEvidence = {
  schemaVersion: typeof MIGRATION_TARGET_STATE_SCHEMA_VERSION;
  batchId: string;
  candidateSha: string;
  sourceSystem: string;
  sourceSnapshotIdentity: string;
  manifestSha256: string;
  targetEnvironment: "TEST";
  targetMigrationDatabase: string;
  moduleCounts: Record<string, number>;
  legacyMapCountsByModule: Record<string, number>;
  unmappedSkipCountsByModule: Record<string, number>;
  recordCount: number;
  attachmentCount: number;
  legacyMapCount: number;
  danglingLegacyMapCount: 0;
  mappings: StateMapping[];
  unmappedSkips: UnmappedSkip[];
  attachments: AttachmentState[];
  sha256: string;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  const object = objectValue(value);
  if (!object) return value;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalValue(object[key])]));
}

function stateDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function stateKey(sourceEntity: string, sourceId: string): string {
  return `${sourceEntity}:${sourceId}`;
}

function exactModules(values: string[]): boolean {
  return values.length === MIGRATION_TARGET_STATE_MODULES.length
    && new Set(values).size === MIGRATION_TARGET_STATE_MODULES.length
    && MIGRATION_TARGET_STATE_MODULES.every((moduleName) => values.includes(moduleName));
}

function targetIds(mappings: StateMapping[], targetEntity: string): string[] {
  return [...new Set(mappings.filter((mapping) => mapping.targetEntity === targetEntity).map((mapping) => mapping.targetId))];
}

async function existingTargetIds(prisma: PrismaClient, targetEntity: string, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const where = { id: { in: ids } };
  let rows: Array<{ id: string }>;
  switch (targetEntity) {
    case "PERSON": rows = await prisma.person.findMany({ where, select: { id: true } }); break;
    case "ORGANIZATION": rows = await prisma.organization.findMany({ where, select: { id: true } }); break;
    case "ENTERPRISE": rows = await prisma.enterprise.findMany({ where, select: { id: true } }); break;
    case "TALENT": rows = await prisma.talent.findMany({ where, select: { id: true } }); break;
    case "POLICY": rows = await prisma.policy.findMany({ where, select: { id: true } }); break;
    case "DEMAND": rows = await prisma.demand.findMany({ where, select: { id: true } }); break;
    case "DEMAND_PROGRESS": rows = await prisma.demandProgress.findMany({ where, select: { id: true } }); break;
    case "PRESENCE_REPORT": rows = await prisma.presenceReport.findMany({ where, select: { id: true } }); break;
    case "TRIP": rows = await prisma.trip.findMany({ where, select: { id: true } }); break;
    case "ENTERPRISE_VISIT": rows = await prisma.enterpriseVisit.findMany({ where, select: { id: true } }); break;
    case "REIMBURSEMENT": rows = await prisma.reimbursement.findMany({ where, select: { id: true } }); break;
    case "HELP_REQUEST": rows = await prisma.helpRequest.findMany({ where, select: { id: true } }); break;
    case "ANNOUNCEMENT": rows = await prisma.announcement.findMany({ where, select: { id: true } }); break;
    case "ROLE_ASSIGNMENT": rows = await prisma.roleAssignment.findMany({ where, select: { id: true } }); break;
    case "ATTACHMENT": rows = await prisma.attachment.findMany({ where, select: { id: true } }); break;
    default: throw new Error(`MIGRATION_TARGET_STATE_ENTITY_UNSUPPORTED:${targetEntity}`);
  }
  return new Set(rows.map(({ id }) => id));
}

export async function collectMigrationTargetStateEvidence(input: {
  prisma: PrismaClient;
  batchId: string;
  candidateSha: string;
  manifestSha256: string;
  targetEnvironment: string;
  targetMigrationDatabase: string;
}): Promise<MigrationTargetStateEvidence> {
  const { prisma } = input;
  if (input.targetEnvironment.trim().toUpperCase() !== "TEST") throw new Error("MIGRATION_TARGET_STATE_ENVIRONMENT_INVALID");
  if (!/^[a-f0-9]{40}$/i.test(input.candidateSha)) throw new Error("MIGRATION_TARGET_STATE_CANDIDATE_INVALID");
  if (!/^[a-f0-9]{64}$/i.test(input.manifestSha256)) throw new Error("MIGRATION_TARGET_STATE_MANIFEST_INVALID");
  const approvedDatabase = input.targetMigrationDatabase.trim();
  if (!approvedDatabase) throw new Error("MIGRATION_TARGET_STATE_DATABASE_REQUIRED");

  const databaseRows = await prisma.$queryRaw<Array<{ databaseName: string | null }>>`SELECT DATABASE() AS databaseName`;
  const actualDatabase = databaseRows[0]?.databaseName?.trim();
  if (!actualDatabase || actualDatabase !== approvedDatabase) throw new Error("MIGRATION_TARGET_STATE_DATABASE_MISMATCH");

  const batch = await prisma.migrationBatch.findUnique({
    where: { id: input.batchId },
    select: {
      id: true,
      sourceSystem: true,
      snapshotId: true,
      sourceManifestSha256: true,
      codeVersion: true,
      status: true,
      mode: true,
    },
  });
  if (!batch || batch.status !== "SUCCEEDED" || batch.mode !== "FULL_REHEARSAL"
    || batch.codeVersion !== input.candidateSha || batch.sourceManifestSha256 !== input.manifestSha256) {
    throw new Error("MIGRATION_TARGET_STATE_BATCH_INVALID");
  }

  const moduleRows = await prisma.migrationModuleResult.findMany({
    where: { batchId: batch.id },
    select: {
      module: true,
      sourceCount: true,
      successCount: true,
      failedCount: true,
      skippedCount: true,
      mergedCount: true,
      reviewCount: true,
      attachmentCount: true,
      attachmentSuccessCount: true,
      attachmentIssueCount: true,
    },
  });
  if (!exactModules(moduleRows.map(({ module }) => module))) throw new Error("MIGRATION_TARGET_STATE_MODULE_SET_INVALID");
  for (const row of moduleRows) {
    if (row.sourceCount !== row.successCount + row.failedCount + row.skippedCount + row.mergedCount + row.reviewCount
      || row.attachmentCount !== row.attachmentSuccessCount + row.attachmentIssueCount
      || row.failedCount !== 0 || row.reviewCount !== 0 || row.attachmentIssueCount !== 0) {
      throw new Error(`MIGRATION_TARGET_STATE_RECONCILIATION_INVALID:${row.module}`);
    }
  }

  const rawMappings = await prisma.legacyMigrationMap.findMany({
    where: {
      sourceSystem: batch.sourceSystem,
      sourceEntity: { in: [...MIGRATION_TARGET_STATE_MODULES] },
      OR: [
        { firstMigrationBatchId: batch.id },
        { lastMigrationBatchId: batch.id },
      ],
    },
    select: { sourceEntity: true, sourceId: true, targetEntity: true, targetId: true },
  });
  const mappings: StateMapping[] = rawMappings
    .map((mapping) => ({ ...mapping }))
    .sort((left, right) => stateKey(left.sourceEntity, left.sourceId).localeCompare(stateKey(right.sourceEntity, right.sourceId)));
  if (new Set(mappings.map((mapping) => stateKey(mapping.sourceEntity, mapping.sourceId))).size !== mappings.length) {
    throw new Error("MIGRATION_TARGET_STATE_MAPPING_DUPLICATE");
  }

  const skipIssues = await prisma.migrationIssue.findMany({
    where: { migrationBatchId: batch.id, code: "MIGRATION_RESOLUTION_APPLIED" },
    select: { sourceEntity: true, sourceId: true, message: true },
  });
  const unmappedSkips: UnmappedSkip[] = skipIssues
    .filter(({ message }) => message.startsWith("已应用 SKIP resolution"))
    .map(({ sourceEntity, sourceId }) => ({ sourceEntity, sourceId }))
    .sort((left, right) => stateKey(left.sourceEntity, left.sourceId).localeCompare(stateKey(right.sourceEntity, right.sourceId)));
  if (new Set(unmappedSkips.map((skip) => stateKey(skip.sourceEntity, skip.sourceId))).size !== unmappedSkips.length) {
    throw new Error("MIGRATION_TARGET_STATE_UNMAPPED_SKIP_DUPLICATE");
  }
  const mappingKeys = new Set(mappings.map((mapping) => stateKey(mapping.sourceEntity, mapping.sourceId)));
  if (unmappedSkips.some((skip) => mappingKeys.has(stateKey(skip.sourceEntity, skip.sourceId)))) {
    throw new Error("MIGRATION_TARGET_STATE_SKIP_MAPPING_CONFLICT");
  }

  const targetEntities = [...new Set(mappings.map(({ targetEntity }) => targetEntity))];
  let danglingLegacyMapCount = 0;
  for (const targetEntity of targetEntities) {
    const ids = targetIds(mappings, targetEntity);
    const existing = await existingTargetIds(prisma, targetEntity, ids);
    danglingLegacyMapCount += ids.filter((id) => !existing.has(id)).length;
  }
  if (danglingLegacyMapCount !== 0) throw new Error("MIGRATION_TARGET_STATE_DANGLING_MAP");

  const moduleCounts: Record<string, number> = {};
  const legacyMapCountsByModule: Record<string, number> = {};
  const unmappedSkipCountsByModule: Record<string, number> = {};
  for (const moduleName of MIGRATION_TARGET_STATE_MODULES) {
    const row = moduleRows.find((candidate) => candidate.module === moduleName)!;
    const moduleMappings = mappings.filter((mapping) => mapping.sourceEntity === moduleName);
    const distinctTargets = new Set(moduleMappings.map((mapping) => `${mapping.targetEntity}:${mapping.targetId}`)).size;
    moduleCounts[moduleName] = distinctTargets;
    if (moduleName === "ATTACHMENT") {
      if (moduleMappings.length !== row.attachmentSuccessCount || distinctTargets !== row.attachmentSuccessCount) {
        throw new Error("MIGRATION_TARGET_STATE_ATTACHMENT_MAP_COUNT_INVALID");
      }
      continue;
    }
    const moduleUnmappedSkips = unmappedSkips.filter((skip) => skip.sourceEntity === moduleName).length;
    if (moduleUnmappedSkips > row.skippedCount) throw new Error(`MIGRATION_TARGET_STATE_SKIP_COUNT_INVALID:${moduleName}`);
    const requiredMapped = row.successCount + row.mergedCount + row.skippedCount - moduleUnmappedSkips;
    if (moduleMappings.length !== requiredMapped) throw new Error(`MIGRATION_TARGET_STATE_MAP_COUNT_INVALID:${moduleName}`);
    if (requiredMapped === 0 ? distinctTargets !== 0 : distinctTargets < 1 || distinctTargets > requiredMapped) {
      throw new Error(`MIGRATION_TARGET_STATE_TARGET_COUNT_INVALID:${moduleName}`);
    }
    legacyMapCountsByModule[moduleName] = moduleMappings.length;
    unmappedSkipCountsByModule[moduleName] = moduleUnmappedSkips;
  }

  const attachmentRow = moduleRows.find(({ module }) => module === "ATTACHMENT")!;
  const rawAttachmentResults = await prisma.migrationAttachmentResult.findMany({
    where: { migrationBatchId: batch.id, status: "COPIED" },
    select: { sourceAttachmentKey: true, targetAttachmentId: true, targetSha256: true },
  });
  if (rawAttachmentResults.length !== attachmentRow.attachmentSuccessCount) {
    throw new Error("MIGRATION_TARGET_STATE_ATTACHMENT_RESULT_COUNT_INVALID");
  }
  const attachmentMappings = new Map(mappings
    .filter((mapping) => mapping.sourceEntity === "ATTACHMENT")
    .map((mapping) => [mapping.sourceId, mapping]));
  const targetAttachmentIds = rawAttachmentResults.map(({ targetAttachmentId }) => targetAttachmentId).filter((value): value is string => Boolean(value));
  const targetAttachments = await prisma.attachment.findMany({
    where: { id: { in: targetAttachmentIds } },
    select: { id: true, sha256: true },
  });
  const targetAttachmentById = new Map(targetAttachments.map((attachment) => [attachment.id, attachment]));
  const attachments: AttachmentState[] = [];
  for (const result of rawAttachmentResults) {
    if (!result.targetAttachmentId || !result.targetSha256 || !/^[a-f0-9]{64}$/i.test(result.targetSha256)) {
      throw new Error("MIGRATION_TARGET_STATE_ATTACHMENT_RESULT_INVALID");
    }
    const mapping = attachmentMappings.get(result.sourceAttachmentKey);
    const target = targetAttachmentById.get(result.targetAttachmentId);
    if (!mapping || mapping.targetEntity !== "ATTACHMENT" || mapping.targetId !== result.targetAttachmentId
      || !target || target.sha256 !== result.targetSha256) {
      throw new Error("MIGRATION_TARGET_STATE_ATTACHMENT_BINDING_INVALID");
    }
    attachments.push({
      sourceAttachmentKey: result.sourceAttachmentKey,
      targetAttachmentId: result.targetAttachmentId,
      targetSha256: result.targetSha256,
    });
  }
  attachments.sort((left, right) => left.sourceAttachmentKey.localeCompare(right.sourceAttachmentKey));
  if (new Set(attachments.map(({ sourceAttachmentKey }) => sourceAttachmentKey)).size !== attachments.length) {
    throw new Error("MIGRATION_TARGET_STATE_ATTACHMENT_DUPLICATE");
  }

  const legacyMapCount = Object.values(legacyMapCountsByModule).reduce((sum, count) => sum + count, 0);
  const attachmentCount = moduleCounts.ATTACHMENT;
  const recordCount = Object.values(moduleCounts).reduce((sum, count) => sum + count, 0);
  const state = {
    moduleCounts,
    legacyMapCountsByModule,
    unmappedSkipCountsByModule,
    recordCount,
    attachmentCount,
    legacyMapCount,
    danglingLegacyMapCount: 0 as const,
    mappings,
    unmappedSkips,
    attachments,
  };

  return {
    schemaVersion: MIGRATION_TARGET_STATE_SCHEMA_VERSION,
    batchId: batch.id,
    candidateSha: input.candidateSha.toLowerCase(),
    sourceSystem: batch.sourceSystem,
    sourceSnapshotIdentity: batch.snapshotId,
    manifestSha256: input.manifestSha256.toLowerCase(),
    targetEnvironment: "TEST",
    targetMigrationDatabase: actualDatabase,
    ...state,
    sha256: stateDigest(state),
  };
}