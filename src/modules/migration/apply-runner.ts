import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { inspectAttachmentContent, validateIntentFile } from "@/modules/attachment/file-policy";
import type { FileScanAdapter } from "@/modules/attachment/scan/file-scan-adapter";
import type { StorageAdapter } from "@/modules/attachment/storage/storage-adapter";
import type { PermissionActor } from "@/modules/permissions/types";
import { MigrationAdapterRegistry } from "./apply-adapters";
import { reconcileSourceAttachment, type AttachmentPreviewResult } from "./attachment-reconciliation";
import { MigrationError } from "./errors";
import { sourceFingerprint } from "./fingerprint";
import { finalizeReconciliation, emptyModule } from "./reconciliation";
import type { LoadedMigrationResolutions } from "./resolutions";
import { resolutionKey } from "./resolutions";
import { LEGACY_ENTITY_TYPES, type MigrationAppliedRecord, type MigrationPreviewIssue, type ReconciliationModule } from "./types";
import type { LegacySourceProvider } from "./snapshot-provider";
import type { SnapshotManifest } from "./source-contract";
import { MigrationRepository } from "./repository";

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function countAction(module: ReconciliationModule, action: MigrationAppliedRecord["action"]): void {
  module.sourceCount += 1;
  if (action === "CREATE" || action === "UPDATE") module.successCount += 1;
  else if (action === "LINK") module.mergedCount += 1;
  else if (action === "SKIP") module.skippedCount += 1;
  else if (action === "REVIEW") module.reviewCount += 1;
  else module.failedCount += 1;
}

function errorIssue(sourceEntity: string, sourceId: string, error: unknown): MigrationPreviewIssue {
  return {
    sourceEntity: sourceEntity as MigrationPreviewIssue["sourceEntity"],
    sourceId,
    code: error instanceof MigrationError ? error.code : "MIGRATION_APPLY_FAILED",
    severity: error instanceof MigrationError && error.code === "MIGRATION_SOURCE_HISTORY_CHANGED" ? "BLOCKER" : "BLOCKER",
    message: error instanceof MigrationError ? error.message : "源记录实际写入失败",
  };
}

function dedupeIssues(issues: MigrationPreviewIssue[]): MigrationPreviewIssue[] {
  const values = new Map<string, MigrationPreviewIssue>();
  for (const issue of issues) values.set(`${issue.sourceEntity}:${issue.sourceId}:${issue.code}:${issue.field ?? ""}`, issue);
  return [...values.values()];
}

function relationType(entityType: string): string {
  if (entityType === "POLICY") return "PRIMARY_FILE";
  if (entityType === "REIMBURSEMENT") return "INVOICE";
  return "SOURCE_ATTACHMENT";
}

async function validateMigrationScan(record: AttachmentPreviewResult["record"], body: Buffer, scanner: FileScanAdapter) {
  let normalized;
  let detected;
  try {
    normalized = validateIntentFile({ filename: record.originalFilename, declaredMimeType: record.declaredMimeType, expectedSizeBytes: record.size });
    detected = await inspectAttachmentContent({ buffer: body, extension: normalized.extension, declaredMimeType: normalized.declaredMimeType });
  } catch {
    throw new MigrationError("MIGRATION_ATTACHMENT_SCAN_REJECTED", "附件未通过正式文件类型、MIME 或签名策略");
  }
  let scan;
  try {
    scan = await scanner.scan({ content: body, filename: normalized.originalFilename, detectedMimeType: detected.mimeType });
  } catch {
    throw new MigrationError("MIGRATION_ATTACHMENT_SCANNER_UNAVAILABLE", "附件安全扫描服务不可用，迁移附件 fail closed");
  }
  if (!scan.clean) throw new MigrationError("MIGRATION_ATTACHMENT_SCAN_REJECTED", "附件未通过恶意文件扫描");
  return { ...normalized, detected };
}

export type MigrationApplyResult = {
  batchId: string;
  records: MigrationAppliedRecord[];
  issues: MigrationPreviewIssue[];
  reconciliation: ReturnType<typeof finalizeReconciliation>;
  actionCounts: Record<MigrationAppliedRecord["action"], number>;
};

export class MigrationApplyRunner {
  private readonly adapters = new MigrationAdapterRegistry();

  constructor(
    private readonly repository: MigrationRepository,
    private readonly storage: StorageAdapter,
    private readonly scanner: FileScanAdapter,
  ) {}

  async run(input: {
    actor: PermissionActor;
    provider: LegacySourceProvider;
    manifest: SnapshotManifest;
    manifestSha256: string;
    codeVersion: string;
    mode: "SAMPLE_REHEARSAL" | "FULL_REHEARSAL";
    resolutions: LoadedMigrationResolutions;
  }): Promise<MigrationApplyResult> {
    let batchId: string | undefined;
    try {
      const batch = await this.repository.prisma.migrationBatch.create({ data: {
        sourceSystem: input.manifest.sourceSystem,
        snapshotId: input.manifest.snapshotId,
        snapshotAt: new Date(input.manifest.snapshotAt),
        sourceSchemaVersion: input.manifest.schemaVersion,
        sourceManifestSha256: input.manifestSha256,
        codeVersion: input.codeVersion,
        mappingVersion: input.manifest.mappingVersion,
        resolutionVersion: input.resolutions.version,
        status: "RUNNING",
        mode: input.mode,
        activeKey: input.manifest.sourceSystem,
        startedAt: new Date(),
        createdByPersonId: input.actor.personId,
      } });
      batchId = batch.id;
    } catch (error) {
      if (this.repository.isActiveConflict(error)) throw new MigrationError("MIGRATION_BATCH_STATE_CONFLICT", "同一 sourceSystem 已有 active migration");
      throw error;
    }

    try {
      const records: MigrationAppliedRecord[] = [];
      const issues: MigrationPreviewIssue[] = [];
      const modules: ReconciliationModule[] = [];
      const sourceAttachments: AttachmentPreviewResult[] = [];
      const validatedAttachmentShaByParent = new Map<string, string>();

      for await (const item of input.provider.listAttachments()) {
        issues.push(...item.issues);
        if (!item.record) continue;
        const validation = await reconcileSourceAttachment(input.provider, item.record);
        sourceAttachments.push(validation);
        if (validation.issue) issues.push(validation.issue);
        if (validation.status === "VALIDATED" && validation.actualSha256) {
          validatedAttachmentShaByParent.set(`${validation.record.sourceEntity}:${validation.record.sourceId}`, validation.actualSha256);
        }
      }

      for (const entityType of LEGACY_ENTITY_TYPES) {
        const moduleResult = emptyModule(entityType);
        modules.push(moduleResult);
        for await (const item of input.provider.list(entityType)) {
          issues.push(...item.issues);
          if (!item.record) {
            const failed = { sourceEntity: entityType, sourceId: item.issues[0]?.sourceId ?? "UNKNOWN", action: "FAILED" as const, issues: item.issues };
            records.push(failed); countAction(moduleResult, failed.action); continue;
          }
          const record = item.record;
          const preparedPasswordHash = await this.adapters.prepare(record);
          try {
            const applied = await this.repository.transaction(async (tx) => {
              const existingMap = await tx.legacyMigrationMap.findUnique({ where: { sourceSystem_sourceEntity_sourceId: { sourceSystem: input.manifest.sourceSystem, sourceEntity: record.entityType, sourceId: record.sourceId } } });
              const resolution = input.resolutions.resolutions.get(resolutionKey(record.entityType, record.sourceId));
              const currentFingerprint = sourceFingerprint(record.payload);
              const outcome = await this.adapters.apply(record, { tx, actor: input.actor, sourceSystem: input.manifest.sourceSystem, snapshotAt: new Date(input.manifest.snapshotAt), resolution, existingMap: existingMap ?? undefined, currentFingerprint, preparedPasswordHash, validatedAttachmentShaByParent });
              if (outcome.targetId && outcome.targetEntity && ["CREATE", "LINK", "UPDATE", "SKIP"].includes(outcome.action)) {
                await this.repository.upsertMap(tx, { sourceSystem: input.manifest.sourceSystem, sourceEntity: record.entityType, sourceId: record.sourceId, targetEntity: outcome.targetEntity, targetId: outcome.targetId, sourceFingerprint: currentFingerprint, immutableHistory: outcome.immutableHistory ?? false, batchId: batchId!, allowFingerprintAdvance: outcome.action === "UPDATE" || outcome.action === "LINK" });
              }
              for (const mapping of outcome.mappings ?? []) {
                await this.repository.upsertMap(tx, { ...mapping, sourceSystem: input.manifest.sourceSystem, batchId: batchId! });
              }
              return { sourceEntity: record.entityType, sourceId: record.sourceId, action: outcome.action, targetEntity: outcome.targetEntity, targetId: outcome.targetId, issues: outcome.issues } satisfies MigrationAppliedRecord;
            });
            records.push(applied); issues.push(...applied.issues); countAction(moduleResult, applied.action);
          } catch (error) {
            const failedIssue = errorIssue(record.entityType, record.sourceId, error);
            const failed = { sourceEntity: record.entityType, sourceId: record.sourceId, action: "FAILED" as const, issues: [failedIssue] };
            records.push(failed); issues.push(failedIssue); countAction(moduleResult, failed.action);
          }
        }
      }

      const attachmentModule = emptyModule("ATTACHMENT");
      modules.push(attachmentModule);
      for (const source of sourceAttachments) {
        let applied: { record: MigrationAppliedRecord; copied: boolean };
        try {
          applied = await this.applyAttachment({ ...input, batchId, source });
        } catch (error) {
          const failedIssue = errorIssue("ATTACHMENT", source.record.sourceAttachmentId, error);
          if (!await this.repository.prisma.migrationAttachmentResult.findFirst({ where: { migrationBatchId: batchId, sourceEntity: source.record.sourceEntity, sourceId: source.record.sourceId, sourceAttachmentKey: source.record.sourceAttachmentId } })) {
            await this.repository.prisma.migrationAttachmentResult.create({ data: { migrationBatchId: batchId, sourceEntity: source.record.sourceEntity, sourceId: source.record.sourceId, sourceAttachmentKey: source.record.sourceAttachmentId, status: "COPY_FAILED", sourceSha256: source.record.sha256, sourceSize: BigInt(source.record.size), errorCode: failedIssue.code } });
          }
          applied = { record: { sourceEntity: "ATTACHMENT", sourceId: source.record.sourceAttachmentId, action: "FAILED", issues: [failedIssue] }, copied: false };
        }
        records.push(applied.record); issues.push(...applied.record.issues);
        countAction(attachmentModule, applied.record.action);
        attachmentModule.attachmentCount += 1;
        if (applied.copied) attachmentModule.attachmentSuccessCount += 1;
        else attachmentModule.attachmentIssueCount += 1;
      }

      const uniqueIssues = dedupeIssues(issues);
      const unresolvedBlockerCount = uniqueIssues.filter((value) => value.severity === "BLOCKER").length;
      const reconciliation = finalizeReconciliation({
        sourceSystem: input.manifest.sourceSystem,
        snapshotId: input.manifest.snapshotId,
        schemaVersion: input.manifest.schemaVersion,
        snapshotAt: input.manifest.snapshotAt,
        mode: input.mode,
        dryRun: false,
        modules,
        unresolvedBlockerCount,
        fullRehearsalStatus: input.mode === "FULL_REHEARSAL" ? "COMPLETED" : "FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT",
      });
      const actionCounts = { CREATE: 0, LINK: 0, UPDATE: 0, SKIP: 0, REVIEW: 0, FAILED: 0 };
      for (const record of records) actionCounts[record.action] += 1;
      const hasReview = uniqueIssues.some((value) => value.severity !== "WARNING") || actionCounts.REVIEW > 0 || actionCounts.FAILED > 0;
      await this.repository.transaction(async (tx) => {
        await this.repository.lockBatch(tx, batchId!);
        await tx.migrationBatch.update({ where: { id: batchId! }, data: { status: "RECONCILING" } });
        for (const moduleResult of modules) await tx.migrationModuleResult.create({ data: { batchId: batchId!, module: moduleResult.module, sourceCount: moduleResult.sourceCount, successCount: moduleResult.successCount, failedCount: moduleResult.failedCount, skippedCount: moduleResult.skippedCount, mergedCount: moduleResult.mergedCount, reviewCount: moduleResult.reviewCount, attachmentCount: moduleResult.attachmentCount, attachmentSuccessCount: moduleResult.attachmentSuccessCount, attachmentIssueCount: moduleResult.attachmentIssueCount, startedAt: new Date(), finishedAt: new Date() } });
        for (const value of uniqueIssues) await tx.migrationIssue.create({ data: { migrationBatchId: batchId!, sourceEntity: value.sourceEntity, sourceId: value.sourceId, code: value.code, severity: value.severity, field: value.field, message: value.message, candidateJson: value.candidates ? json(value.candidates) : undefined, sourceSnapshotJson: value.sourceSnapshot ? json(value.sourceSnapshot) : undefined } });
        const status = !reconciliation.formulaPass ? "FAILED" : hasReview ? "REVIEW_REQUIRED" : "SUCCEEDED";
        await tx.migrationBatch.update({ where: { id: batchId! }, data: { status, activeKey: null, finishedAt: new Date(), reconciliationJson: json({ ...reconciliation, phase: "ACTUAL_APPLY", actionCounts, resolutionSha256: input.resolutions.sha256 }), failureCode: reconciliation.formulaPass ? null : "MIGRATION_RECONCILIATION_FAILED", failureSummary: reconciliation.formulaPass ? null : "actual apply 对账公式不成立" } });
        await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: status === "SUCCEEDED" ? "MIGRATION_BATCH_SUCCEEDED" : status === "FAILED" ? "MIGRATION_BATCH_FAILED" : "MIGRATION_BATCH_RECONCILED", entityType: "MIGRATION_BATCH", entityId: batchId!, afterJson: json({ status, snapshotId: input.manifest.snapshotId, actionCounts, resolutionVersion: input.resolutions.version, resolutionSha256: input.resolutions.sha256 }) } });
      });
      return { batchId, records, issues: uniqueIssues, reconciliation, actionCounts };
    } catch (error) {
      await this.repository.prisma.migrationBatch.updateMany({ where: { id: batchId, activeKey: { not: null } }, data: { status: "FAILED", activeKey: null, finishedAt: new Date(), failureCode: error instanceof MigrationError ? error.code : "MIGRATION_APPLY_FAILED", failureSummary: error instanceof Error ? error.message.slice(0, 1000) : "迁移失败" } });
      throw error;
    }
  }

  private async applyAttachment(input: {
    actor: PermissionActor;
    provider: LegacySourceProvider;
    manifest: SnapshotManifest;
    batchId: string;
    source: AttachmentPreviewResult;
  }): Promise<{ record: MigrationAppliedRecord; copied: boolean }> {
    const value = input.source.record;
    const createResult = async (status: "MISSING" | "CORRUPTED" | "HASH_MISMATCH" | "COPY_FAILED" | "SKIPPED", errorCode: string) => {
      await this.repository.prisma.migrationAttachmentResult.create({ data: { migrationBatchId: input.batchId, sourceEntity: value.sourceEntity, sourceId: value.sourceId, sourceAttachmentKey: value.sourceAttachmentId, status, sourceSha256: value.sha256, sourceSize: BigInt(value.size), errorCode } });
    };
    if (input.source.status !== "VALIDATED") {
      const issue = input.source.issue ?? { sourceEntity: "ATTACHMENT" as const, sourceId: value.sourceAttachmentId, code: "MIGRATION_ATTACHMENT_INVALID", severity: "BLOCKER" as const, message: "source attachment 未通过校验" };
      await createResult(input.source.status, issue.code);
      return { record: { sourceEntity: "ATTACHMENT", sourceId: value.sourceAttachmentId, action: "FAILED", issues: [issue] }, copied: false };
    }
    const parentMap = await this.repository.prisma.legacyMigrationMap.findUnique({ where: { sourceSystem_sourceEntity_sourceId: { sourceSystem: input.manifest.sourceSystem, sourceEntity: value.sourceEntity, sourceId: value.sourceId } } });
    if (!parentMap) {
      const issue: MigrationPreviewIssue = { sourceEntity: "ATTACHMENT", sourceId: value.sourceAttachmentId, code: "MIGRATION_ATTACHMENT_PARENT_UNRESOLVED", severity: "REVIEW", message: "附件父业务记录尚无有效 target map" };
      await createResult("SKIPPED", issue.code);
      return { record: { sourceEntity: "ATTACHMENT", sourceId: value.sourceAttachmentId, action: "REVIEW", issues: [issue] }, copied: false };
    }
    const existingMap = await this.repository.prisma.legacyMigrationMap.findUnique({ where: { sourceSystem_sourceEntity_sourceId: { sourceSystem: input.manifest.sourceSystem, sourceEntity: "ATTACHMENT", sourceId: value.sourceAttachmentId } } });
    if (existingMap) {
      const target = await this.repository.prisma.attachment.findUnique({ where: { id: existingMap.targetId }, include: { links: true } });
      if (!target?.objectKey || target.uploadStatus !== "UPLOADED" || target.scanStatus !== "PASSED" || target.isTemporary || target.sha256 !== value.sha256 || Number(target.actualSizeBytes) !== value.size || !target.links.some((link) => link.entityType === parentMap.targetEntity && link.entityId === parentMap.targetId)) throw new MigrationError("MIGRATION_ATTACHMENT_TARGET_INVALID", "既有附件 Map 的目标对象或 Link 已失效");
      const body = await this.storage.readObject(target.objectKey);
      const digest = createHash("sha256").update(body).digest("hex");
      if (digest !== value.sha256 || body.byteLength !== value.size) throw new MigrationError("MIGRATION_ATTACHMENT_TARGET_INVALID", "目标附件重读校验失败");
      await this.repository.transaction(async (tx) => {
        await this.repository.upsertMap(tx, { sourceSystem: input.manifest.sourceSystem, sourceEntity: "ATTACHMENT", sourceId: value.sourceAttachmentId, targetEntity: "ATTACHMENT", targetId: target.id, sourceFingerprint: sourceFingerprint(value), immutableHistory: true, batchId: input.batchId });
        await tx.migrationAttachmentResult.create({ data: { migrationBatchId: input.batchId, sourceEntity: value.sourceEntity, sourceId: value.sourceId, sourceAttachmentKey: value.sourceAttachmentId, status: "COPIED", sourceSha256: value.sha256, targetAttachmentId: target.id, targetSha256: digest, sourceSize: BigInt(value.size), targetSize: BigInt(body.byteLength) } });
      });
      return { record: { sourceEntity: "ATTACHMENT", sourceId: value.sourceAttachmentId, action: "SKIP", targetEntity: "ATTACHMENT", targetId: target.id, issues: [] }, copied: true };
    }
    const body = await input.provider.getAttachment(value);
    const inspected = await validateMigrationScan(value, body, this.scanner);
    const attachmentId = randomUUID();
    const objectKey = `migration/${input.manifest.sourceSystem.toLowerCase()}/${attachmentId}/${value.sha256}.${inspected.detected.extension}`;
    await this.repository.prisma.attachment.create({ data: { id: attachmentId, originalFilename: inspected.originalFilename, extension: inspected.extension, declaredMimeType: inspected.declaredMimeType, expectedSizeBytes: BigInt(value.size), storageProvider: "TENCENT_COS", bucket: this.storage.bucket, region: this.storage.region, objectKey, uploadStatus: "PENDING_UPLOAD", scanStatus: "PENDING", isTemporary: true, uploadedByPersonId: input.actor.personId } });
    await this.storage.writeObject(objectKey, body, inspected.detected.mimeType);
    const targetBody = await this.storage.readObject(objectKey);
    const digest = createHash("sha256").update(targetBody).digest("hex");
    if (digest !== value.sha256 || targetBody.byteLength !== value.size) {
      await createResult("HASH_MISMATCH", "MIGRATION_ATTACHMENT_TARGET_HASH_MISMATCH");
      const issue: MigrationPreviewIssue = { sourceEntity: "ATTACHMENT", sourceId: value.sourceAttachmentId, code: "MIGRATION_ATTACHMENT_TARGET_HASH_MISMATCH", severity: "BLOCKER", message: "目标对象重读 SHA/size 不一致" };
      return { record: { sourceEntity: "ATTACHMENT", sourceId: value.sourceAttachmentId, action: "FAILED", issues: [issue] }, copied: false };
    }
    await this.repository.transaction(async (tx) => {
      const currentParent = await tx.legacyMigrationMap.findUnique({ where: { sourceSystem_sourceEntity_sourceId: { sourceSystem: input.manifest.sourceSystem, sourceEntity: value.sourceEntity, sourceId: value.sourceId } } });
      if (!currentParent || currentParent.targetId !== parentMap.targetId) throw new MigrationError("MIGRATION_ATTACHMENT_PARENT_UNRESOLVED", "附件父 Map 在提交前发生变化");
      await tx.attachment.update({ where: { id: attachmentId }, data: { detectedMimeType: inspected.detected.mimeType, detectedFileType: inspected.detected.extension, actualSizeBytes: BigInt(targetBody.byteLength), sha256: digest, uploadStatus: "UPLOADED", scanStatus: "PASSED", isTemporary: false } });
      await tx.attachmentLink.create({ data: { attachmentId, entityType: parentMap.targetEntity, entityId: parentMap.targetId, relationType: relationType(value.sourceEntity), createdByPersonId: input.actor.personId } });
      await this.repository.upsertMap(tx, { sourceSystem: input.manifest.sourceSystem, sourceEntity: "ATTACHMENT", sourceId: value.sourceAttachmentId, targetEntity: "ATTACHMENT", targetId: attachmentId, sourceFingerprint: sourceFingerprint(value), immutableHistory: true, batchId: input.batchId });
      await tx.migrationAttachmentResult.create({ data: { migrationBatchId: input.batchId, sourceEntity: value.sourceEntity, sourceId: value.sourceId, sourceAttachmentKey: value.sourceAttachmentId, status: "COPIED", sourceSha256: value.sha256, targetAttachmentId: attachmentId, targetSha256: digest, sourceSize: BigInt(value.size), targetSize: BigInt(targetBody.byteLength) } });
    });
    return { record: { sourceEntity: "ATTACHMENT", sourceId: value.sourceAttachmentId, action: "CREATE", targetEntity: "ATTACHMENT", targetId: attachmentId, issues: [] }, copied: true };
  }
}
