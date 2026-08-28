import { createHash } from "node:crypto";
import type { LegacyAttachmentManifestRecord } from "./source-contract";
import type { LegacySourceProvider } from "./snapshot-provider";
import type { MigrationPreviewIssue } from "./types";

export type AttachmentPreviewResult = { record: LegacyAttachmentManifestRecord; status: "VALIDATED" | "MISSING" | "CORRUPTED" | "HASH_MISMATCH"; actualSha256?: string; actualSize?: number; issue?: MigrationPreviewIssue };

export async function reconcileSourceAttachment(provider: LegacySourceProvider, record: LegacyAttachmentManifestRecord): Promise<AttachmentPreviewResult> {
  try {
    const buffer = await provider.getAttachment(record);
    const actualSha256 = createHash("sha256").update(buffer).digest("hex");
    if (buffer.length !== record.size) return { record, status: "CORRUPTED", actualSha256, actualSize: buffer.length, issue: { sourceEntity: "ATTACHMENT", sourceId: record.sourceAttachmentId, code: "MIGRATION_ATTACHMENT_CORRUPTED", severity: "BLOCKER", message: "附件实际大小与 manifest 不一致" } };
    if (actualSha256 !== record.sha256) return { record, status: "HASH_MISMATCH", actualSha256, actualSize: buffer.length, issue: { sourceEntity: "ATTACHMENT", sourceId: record.sourceAttachmentId, code: "MIGRATION_ATTACHMENT_HASH_MISMATCH", severity: "BLOCKER", message: "附件 SHA-256 与 manifest 不一致" } };
    return { record, status: "VALIDATED", actualSha256, actualSize: buffer.length };
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith("MIGRATION_SOURCE_") ? error.message : "MIGRATION_ATTACHMENT_MISSING";
    return { record, status: "MISSING", issue: { sourceEntity: "ATTACHMENT", sourceId: record.sourceAttachmentId, code: code === "MIGRATION_ATTACHMENT_MISSING" ? code : "MIGRATION_SOURCE_PATH_INVALID", severity: "BLOCKER", message: "附件不存在、路径不安全或无法读取" } };
  }
}
