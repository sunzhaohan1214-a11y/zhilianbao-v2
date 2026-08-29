import { AttachmentError } from "./attachment-errors";
import { inspectAttachmentContent, MAX_ATTACHMENT_SIZE_BYTES, sha256 } from "./file-policy";
import { AttachmentRepository } from "./repository/attachment-repository";
import type { FileScanAdapter } from "./scan/file-scan-adapter";
import type { StorageAdapter } from "./storage/storage-adapter";

export class AttachmentScanService {
  constructor(
    private readonly repository: AttachmentRepository,
    private readonly storage: StorageAdapter,
    private readonly scanner: FileScanAdapter,
  ) {}

  async processAttachmentScan(attachmentId: string) {
    const attachment = await this.repository.findById(attachmentId);
    if (!attachment) throw new AttachmentError("ATTACHMENT_NOT_FOUND", "附件不存在");
    if (attachment.scanStatus === "PASSED" || attachment.scanStatus === "REJECTED") {
      return { attachmentId, scanStatus: attachment.scanStatus };
    }
    if (attachment.uploadStatus !== "UPLOADED" || !attachment.objectKey) {
      throw new AttachmentError("ATTACHMENT_STATE_CONFLICT", "附件尚未完成上传");
    }
    // M0-006 must recover work that crashes after entering SCANNING so attachments cannot remain stuck forever.
    if (!await this.repository.beginScan(attachment.id)) {
      throw new AttachmentError("ATTACHMENT_STATE_CONFLICT", "附件扫描任务正在处理");
    }

    try {
      let content: Buffer;
      try {
        content = await this.storage.readObject(attachment.objectKey);
      } catch (error) {
        await this.repository.markScanFailed(attachment.id, "STORAGE_UNAVAILABLE");
        throw error;
      }
      const digest = sha256(content);
      if (
        content.byteLength < 1
        || content.byteLength > MAX_ATTACHMENT_SIZE_BYTES
        || content.byteLength !== Number(attachment.actualSizeBytes)
      ) {
        await this.repository.markScanRejected({
          id: attachment.id,
          reason: "FINAL_SIZE_MISMATCH",
          actualSizeBytes: BigInt(content.byteLength),
          sha256: digest,
        });
        return { attachmentId, scanStatus: "REJECTED" as const };
      }

      let detected;
      try {
        detected = await inspectAttachmentContent({
          buffer: content,
          extension: attachment.extension,
          declaredMimeType: attachment.declaredMimeType,
        });
      } catch {
        await this.repository.markScanRejected({
          id: attachment.id,
          reason: "TYPE_MISMATCH_OR_UNSUPPORTED",
          actualSizeBytes: BigInt(content.byteLength),
          sha256: digest,
        });
        return { attachmentId, scanStatus: "REJECTED" as const };
      }

      let scan;
      try {
        scan = await this.scanner.scan({
          content,
          filename: attachment.originalFilename,
          detectedMimeType: detected.mimeType,
        });
      } catch {
        await this.repository.markScanFailed(attachment.id, "SCANNER_UNAVAILABLE");
        throw new AttachmentError("ATTACHMENT_SCANNER_UNAVAILABLE", "文件安全检查服务暂时不可用");
      }
      if (!scan.clean) {
        await this.repository.markScanRejected({
          id: attachment.id,
          reason: "MALWARE_DETECTED",
          actualSizeBytes: BigInt(content.byteLength),
          sha256: digest,
          detectedMimeType: detected.mimeType,
          detectedFileType: detected.extension,
        });
        return { attachmentId, scanStatus: "REJECTED" as const };
      }
      await this.repository.markScanPassed({
        id: attachment.id,
        actualSizeBytes: BigInt(content.byteLength),
        sha256: digest,
        detectedMimeType: detected.mimeType,
        detectedFileType: detected.extension,
      });
      return { attachmentId, scanStatus: "PASSED" as const, sha256: digest };
    } catch (error) {
      // A lost DB acknowledgement after the external scan must remain retryable. The
      // conditional write never downgrades an already terminal PASSED/REJECTED row.
      try { await this.repository.markScanFailed(attachment.id, "SCAN_PROCESSING_FAILED"); }
      catch { /* The Job lease/retry remains the durable recovery path. */ }
      throw error;
    }
  }
}
