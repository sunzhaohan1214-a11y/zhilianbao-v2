import { Prisma } from "@/generated/prisma/client";
import type { PermissionActor } from "@/modules/permissions/types";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { MigrationReconciliation, MigrationPreviewIssue } from "./types";
import type { SnapshotManifest } from "./source-contract";
import type { AttachmentPreviewResult } from "./attachment-reconciliation";
import { MigrationError } from "./errors";
import { MigrationRepository } from "./repository";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import type { StorageAdapter } from "@/modules/attachment/storage/storage-adapter";
import type { FileScanAdapter } from "@/modules/attachment/scan/file-scan-adapter";
import { MigrationApplyRunner } from "./apply-runner";
import type { LegacySourceProvider } from "./snapshot-provider";
import type { LoadedMigrationResolutions } from "./resolutions";

type PersistInput = {
  actor: PermissionActor;
  manifest: SnapshotManifest;
  manifestSha256: string;
  codeVersion: string;
  mode: "SAMPLE_REHEARSAL" | "FULL_REHEARSAL";
  reconciliation: MigrationReconciliation;
  issues: MigrationPreviewIssue[];
  attachmentResults: AttachmentPreviewResult[];
};

function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }

export class MigrationService {
  constructor(
    private readonly repository = new MigrationRepository(),
    private readonly storage: StorageAdapter = getAttachmentRuntime().storage,
    private readonly scanner: FileScanAdapter = getAttachmentRuntime().scanner,
  ) {}

  private async authorize(actor: PermissionActor, action: "migration.execute" | "migration.view") {
    if (actor.accountStatus !== "NORMAL" || !actor.effectiveRoles.includes("SUPER_ADMIN") || !actor.hasSystem) throw new MigrationError("MIGRATION_FORBIDDEN", "仅 active SUPER_ADMIN 可执行迁移", 403);
    await authorizeActor({ actor, action, resource: { resourceType: "migration_batch", requiredScope: "SYSTEM" } });
  }

  async applySnapshot(input: {
    actor: PermissionActor;
    provider: LegacySourceProvider;
    manifest: SnapshotManifest;
    manifestSha256: string;
    codeVersion: string;
    mode: "SAMPLE_REHEARSAL" | "FULL_REHEARSAL";
    resolutions: LoadedMigrationResolutions;
  }) {
    await this.authorize(input.actor, "migration.execute");
    if (process.env.APP_ENV === "production") throw new MigrationError("MIGRATION_PRODUCTION_REFUSED", "本版本拒绝在 production 执行迁移");
    if (input.mode === "FULL_REHEARSAL" && input.manifest.snapshotKind !== "FULL") throw new MigrationError("FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT", "没有受控 V1 full snapshot");
    return new MigrationApplyRunner(this.repository, this.storage, this.scanner).run(input);
  }

  async persistRehearsal(input: PersistInput) {
    await this.authorize(input.actor, "migration.execute");
    if (process.env.APP_ENV === "production") throw new MigrationError("MIGRATION_PRODUCTION_REFUSED", "本版本拒绝在 production 执行迁移");
    if (input.mode === "FULL_REHEARSAL" && input.manifest.snapshotKind !== "FULL") throw new MigrationError("FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT", "没有受控 V1 full snapshot");
    let batchId: string;
    try {
      const batch = await this.repository.prisma.migrationBatch.create({ data: {
        sourceSystem: input.manifest.sourceSystem, snapshotId: input.manifest.snapshotId, snapshotAt: new Date(input.manifest.snapshotAt), sourceSchemaVersion: input.manifest.schemaVersion,
        sourceManifestSha256: input.manifestSha256, codeVersion: input.codeVersion, mappingVersion: input.manifest.mappingVersion, status: "RUNNING", mode: input.mode,
        activeKey: input.manifest.sourceSystem, startedAt: new Date(), createdByPersonId: input.actor.personId,
      } });
      batchId = batch.id;
    } catch (error) {
      if (this.repository.isActiveConflict(error)) throw new MigrationError("MIGRATION_BATCH_STATE_CONFLICT", "同一 sourceSystem 已有 RUNNING/RECONCILING 迁移");
      throw error;
    }
    try {
      return await this.repository.transaction(async (tx) => {
        await this.repository.lockBatch(tx, batchId);
        await tx.migrationBatch.update({ where: { id: batchId }, data: { status: "RECONCILING" } });
        for (const moduleResult of input.reconciliation.modules) await tx.migrationModuleResult.create({ data: { batchId, module: moduleResult.module, sourceCount: moduleResult.sourceCount, successCount: moduleResult.successCount,
          failedCount: moduleResult.failedCount, skippedCount: moduleResult.skippedCount, mergedCount: moduleResult.mergedCount, reviewCount: moduleResult.reviewCount, attachmentCount: moduleResult.attachmentCount,
          attachmentSuccessCount: moduleResult.attachmentSuccessCount, attachmentIssueCount: moduleResult.attachmentIssueCount, startedAt: new Date(), finishedAt: new Date() } });
        for (const value of input.issues) await tx.migrationIssue.create({ data: { migrationBatchId: batchId, sourceEntity: value.sourceEntity, sourceId: value.sourceId,
          code: value.code, severity: value.severity, field: value.field, message: value.message, candidateJson: value.candidates ? json(value.candidates) : undefined,
          sourceSnapshotJson: value.sourceSnapshot ? json(value.sourceSnapshot) : undefined } });
        for (const value of input.attachmentResults) await tx.migrationAttachmentResult.create({ data: { migrationBatchId: batchId, sourceEntity: value.record.sourceEntity,
          sourceId: value.record.sourceId, sourceAttachmentKey: value.record.sourceAttachmentId, status: value.status === "VALIDATED" ? "SKIPPED" : value.status, sourceSha256: value.record.sha256,
          targetSha256: value.actualSha256, sourceSize: BigInt(value.record.size), targetSize: value.actualSize === undefined ? undefined : BigInt(value.actualSize), errorCode: value.issue?.code } });
        const hasReview = input.issues.some(({ severity }) => severity === "BLOCKER" || severity === "REVIEW");
        const finalStatus = !input.reconciliation.formulaPass ? "FAILED" : hasReview ? "REVIEW_REQUIRED" : "SUCCEEDED";
        const updated = await tx.migrationBatch.update({ where: { id: batchId }, data: { status: finalStatus, activeKey: null, finishedAt: new Date(), reconciliationJson: json({ ...input.reconciliation, dryRun: false }),
          failureCode: input.reconciliation.formulaPass ? null : "MIGRATION_RECONCILIATION_FAILED", failureSummary: input.reconciliation.formulaPass ? null : "模块对账公式不成立" } });
        await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: finalStatus === "SUCCEEDED" ? "MIGRATION_BATCH_SUCCEEDED" : finalStatus === "FAILED" ? "MIGRATION_BATCH_FAILED" : "MIGRATION_BATCH_RECONCILED",
          entityType: "MIGRATION_BATCH", entityId: batchId, afterJson: json({ status: finalStatus, snapshotId: input.manifest.snapshotId, issueCount: input.issues.length }) } });
        return updated;
      });
    } catch (error) {
      await this.repository.prisma.migrationBatch.updateMany({ where: { id: batchId, activeKey: { not: null } }, data: { status: "FAILED", activeKey: null, finishedAt: new Date(), failureCode: error instanceof MigrationError ? error.code : "MIGRATION_RECONCILIATION_FAILED", failureSummary: error instanceof Error ? error.message.slice(0, 1000) : "迁移失败" } });
      throw error;
    }
  }
}
