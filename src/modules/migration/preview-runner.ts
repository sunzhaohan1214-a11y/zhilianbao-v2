import type { EnterpriseMatchCandidate, PersonMatchCandidate, PolicyMatchCandidate, TalentMatchCandidate } from "@/modules/entity-matching";
import { analyzeLegacyRecord, type MigrationMatchContext } from "./adapters";
import { reconcileSourceAttachment, type AttachmentPreviewResult } from "./attachment-reconciliation";
import { finalizeReconciliation, emptyModule } from "./reconciliation";
import type { LegacySourceProvider } from "./snapshot-provider";
import { LEGACY_ENTITY_TYPES, type LegacyRecord, type MigrationPreviewIssue, type ReconciliationModule } from "./types";

function countOutcome(module: ReturnType<typeof emptyModule>, classification: ReturnType<typeof analyzeLegacyRecord>["classification"]) {
  module.sourceCount += 1;
  if (classification === "SUCCESS") module.successCount += 1;
  else if (classification === "FAILED") module.failedCount += 1;
  else if (classification === "SKIPPED") module.skippedCount += 1;
  else if (classification === "MERGED") module.mergedCount += 1;
  else module.reviewCount += 1;
}

function addSourceCandidate(context: MigrationMatchContext, record: LegacyRecord) {
  const value = record.payload;
  if (record.entityType === "PERSON") (context.people as PersonMatchCandidate[]).push({ id: `source:${record.sourceId}`, name: String(value.name), phone: value.phone ? String(value.phone) : undefined, personStatus: "ACTIVE" });
  if (record.entityType === "ENTERPRISE") (context.enterprises as EnterpriseMatchCandidate[]).push({ id: `source:${record.sourceId}`, name: String(value.name), responsibleAreaId: String(value.responsibleAreaName), creditCode: value.creditCode ? String(value.creditCode) : undefined, status: "NORMAL" });
  if (record.entityType === "TALENT") (context.talents as TalentMatchCandidate[]).push({ id: `source:${record.sourceId}`, name: String(value.name), organizationName: String(value.organizationName), professionalDirection: String(value.professionalDirection) });
  if (record.entityType === "POLICY") (context.policies as PolicyMatchCandidate[]).push({ id: `source:${record.sourceId}`, title: String(value.title), publishingDepartment: String(value.publishingDepartment), publishedDate: String(value.publishedDate), primaryFileSha256: String(value.primaryFileSha256) });
}

export async function runMigrationPreview(provider: LegacySourceProvider, input: { mode: "SAMPLE_REHEARSAL" | "FULL_REHEARSAL"; fullSnapshotAvailable?: boolean }) {
  const { manifest, manifestSha256 } = await provider.describeSnapshot();
  if (input.mode === "FULL_REHEARSAL" && manifest.snapshotKind !== "FULL") throw new Error("FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT");
  const issues: MigrationPreviewIssue[] = [];
  const modules: ReconciliationModule[] = [];
  const context: MigrationMatchContext = { people: [], enterprises: [], talents: [], policies: [] };
  for (const entityType of LEGACY_ENTITY_TYPES) {
    const moduleResult = emptyModule(entityType);
    modules.push(moduleResult);
    let previousSourceId = "";
    for await (const item of provider.list(entityType)) {
      issues.push(...item.issues);
      if (!item.record) { moduleResult.sourceCount += 1; moduleResult.failedCount += 1; continue; }
      if (previousSourceId && item.record.sourceId.localeCompare(previousSourceId) < 0) {
        const orderingIssue: MigrationPreviewIssue = { sourceEntity: item.record.entityType, sourceId: item.record.sourceId, code: "MIGRATION_SOURCE_ORDER_INVALID", severity: "BLOCKER", message: "同模块记录必须按 sourceId 稳定升序" };
        issues.push(orderingIssue); countOutcome(moduleResult, "FAILED"); continue;
      }
      previousSourceId = item.record.sourceId;
      const outcome = analyzeLegacyRecord(item.record, context);
      issues.push(...outcome.issues);
      countOutcome(moduleResult, outcome.classification);
      addSourceCandidate(context, item.record);
    }
  }
  const attachmentModule = emptyModule("ATTACHMENT");
  const attachmentResults: AttachmentPreviewResult[] = [];
  for await (const item of provider.listAttachments()) {
    issues.push(...item.issues);
    attachmentModule.sourceCount += 1; attachmentModule.attachmentCount += 1;
    if (!item.record) { attachmentModule.failedCount += 1; attachmentModule.attachmentIssueCount += 1; continue; }
    const result = await reconcileSourceAttachment(provider, item.record);
    attachmentResults.push(result);
    if (result.issue) issues.push(result.issue);
    if (result.status === "VALIDATED") { attachmentModule.successCount += 1; attachmentModule.attachmentSuccessCount += 1; }
    else { attachmentModule.failedCount += 1; attachmentModule.attachmentIssueCount += 1; }
  }
  modules.push(attachmentModule);
  const unresolvedBlockerCount = issues.filter(({ severity }) => severity === "BLOCKER").length;
  return {
    manifest, manifestSha256, issues, attachmentResults,
    reconciliation: finalizeReconciliation({ sourceSystem: manifest.sourceSystem, snapshotId: manifest.snapshotId, schemaVersion: manifest.schemaVersion,
      snapshotAt: manifest.snapshotAt, mode: input.mode, dryRun: true, modules, unresolvedBlockerCount,
      fullRehearsalStatus: input.mode === "FULL_REHEARSAL" ? "COMPLETED" : input.fullSnapshotAvailable ? "NOT_REQUESTED" : "FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT" }),
  };
}
