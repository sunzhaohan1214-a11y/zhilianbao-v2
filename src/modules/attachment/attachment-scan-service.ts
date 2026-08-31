import { AttachmentError } from "./attachment-errors";
import { inspectAttachmentContent, MAX_ATTACHMENT_SIZE_BYTES, sha256 } from "./file-policy";
import { AttachmentRepository } from "./repository/attachment-repository";
import type { FileScanAdapter } from "./scan/file-scan-adapter";
import type { StorageAdapter } from "./storage/storage-adapter";
import { writeLog } from "@/lib/logging/logger";
import { safeErrorMetadata } from "@/lib/logging/safe-error";

type ScanSummaryLogger = (entry: Record<string, unknown>, failed: boolean) => void;

export class AttachmentScanService {
  constructor(
    private readonly repository: AttachmentRepository,
    private readonly storage: StorageAdapter,
    private readonly scanner: FileScanAdapter,
    private readonly summaryLogger: ScanSummaryLogger = (entry, failed) => writeLog(failed ? "error" : "info", entry as Parameters<typeof writeLog>[1]),
  ) {}

  async processAttachmentScan(attachmentId: string) {
    const totalStartedAt = Date.now();
    const timings = { repository_lookup_ms: 0, begin_scan_ms: 0, storage_read_ms: 0, content_policy_ms: 0, clamav_scan_ms: 0, terminal_write_ms: 0 };
    let result = "failed";
    const logSummary = (error?: unknown) => {
      const safe = error === undefined ? undefined : safeErrorMetadata(error);
      try {
        this.summaryLogger({ module: "attachment_scan", result, attachmentId, ...timings, total_ms: Date.now() - totalStartedAt, ...(safe ? { errorCode: safe.errorCode, errorClass: safe.errorClass } : {}) }, error !== undefined);
      } catch { /* Observability must never alter scan state or retry semantics. */ }
    };
    let phaseStartedAt = Date.now();
    let attachment: Awaited<ReturnType<AttachmentRepository["findById"]>>;
    try {
      attachment = await this.repository.findById(attachmentId);
    } catch (error) {
      timings.repository_lookup_ms = Date.now() - phaseStartedAt;
      logSummary(error);
      throw error;
    }
    timings.repository_lookup_ms = Date.now() - phaseStartedAt;
    if (!attachment) {
      const error = new AttachmentError("ATTACHMENT_NOT_FOUND", "附件不存在");
      logSummary(error);
      throw error;
    }
    if (attachment.scanStatus === "PASSED" || attachment.scanStatus === "REJECTED") {
      result = "terminal_already_present";
      logSummary();
      return { attachmentId, scanStatus: attachment.scanStatus };
    }
    if (attachment.uploadStatus !== "UPLOADED" || !attachment.objectKey) {
      const error = new AttachmentError("ATTACHMENT_STATE_CONFLICT", "附件尚未完成上传");
      logSummary(error);
      throw error;
    }
    // M0-006 must recover work that crashes after entering SCANNING so attachments cannot remain stuck forever.
    phaseStartedAt = Date.now();
    let began: boolean;
    try {
      began = await this.repository.beginScan(attachment.id);
    } catch (error) {
      timings.begin_scan_ms = Date.now() - phaseStartedAt;
      logSummary(error);
      throw error;
    }
    timings.begin_scan_ms = Date.now() - phaseStartedAt;
    if (!began) {
      const error = new AttachmentError("ATTACHMENT_STATE_CONFLICT", "附件扫描任务正在处理");
      logSummary(error);
      throw error;
    }

    try {
      let content: Buffer;
      try {
        phaseStartedAt = Date.now();
        content = await this.storage.readObject(attachment.objectKey);
        timings.storage_read_ms = Date.now() - phaseStartedAt;
      } catch (error) {
        timings.storage_read_ms = Date.now() - phaseStartedAt;
        result = "storage_unavailable";
        phaseStartedAt = Date.now();
        await this.repository.markScanFailed(attachment.id, "STORAGE_UNAVAILABLE");
        timings.terminal_write_ms += Date.now() - phaseStartedAt;
        throw error;
      }
      phaseStartedAt = Date.now();
      const digest = sha256(content);
      if (
        content.byteLength < 1
        || content.byteLength > MAX_ATTACHMENT_SIZE_BYTES
        || content.byteLength !== Number(attachment.actualSizeBytes)
      ) {
        timings.content_policy_ms = Date.now() - phaseStartedAt;
        phaseStartedAt = Date.now();
        await this.repository.markScanRejected({
          id: attachment.id,
          reason: "FINAL_SIZE_MISMATCH",
          actualSizeBytes: BigInt(content.byteLength),
          sha256: digest,
        });
        timings.terminal_write_ms += Date.now() - phaseStartedAt;
        result = "rejected_size";
        logSummary();
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
        timings.content_policy_ms = Date.now() - phaseStartedAt;
        phaseStartedAt = Date.now();
        await this.repository.markScanRejected({
          id: attachment.id,
          reason: "TYPE_MISMATCH_OR_UNSUPPORTED",
          actualSizeBytes: BigInt(content.byteLength),
          sha256: digest,
        });
        timings.terminal_write_ms += Date.now() - phaseStartedAt;
        result = "rejected_type";
        logSummary();
        return { attachmentId, scanStatus: "REJECTED" as const };
      }
      timings.content_policy_ms = Date.now() - phaseStartedAt;

      let scan;
      try {
        phaseStartedAt = Date.now();
        scan = await this.scanner.scan({
          content,
          filename: attachment.originalFilename,
          detectedMimeType: detected.mimeType,
        });
        timings.clamav_scan_ms = Date.now() - phaseStartedAt;
      } catch {
        timings.clamav_scan_ms = Date.now() - phaseStartedAt;
        result = "scanner_unavailable";
        phaseStartedAt = Date.now();
        await this.repository.markScanFailed(attachment.id, "SCANNER_UNAVAILABLE");
        timings.terminal_write_ms += Date.now() - phaseStartedAt;
        throw new AttachmentError("ATTACHMENT_SCANNER_UNAVAILABLE", "文件安全检查服务暂时不可用");
      }
      if (!scan.clean) {
        phaseStartedAt = Date.now();
        await this.repository.markScanRejected({
          id: attachment.id,
          reason: "MALWARE_DETECTED",
          actualSizeBytes: BigInt(content.byteLength),
          sha256: digest,
          detectedMimeType: detected.mimeType,
          detectedFileType: detected.extension,
        });
        timings.terminal_write_ms += Date.now() - phaseStartedAt;
        result = "rejected_malware";
        logSummary();
        return { attachmentId, scanStatus: "REJECTED" as const };
      }
      phaseStartedAt = Date.now();
      await this.repository.markScanPassed({
        id: attachment.id,
        actualSizeBytes: BigInt(content.byteLength),
        sha256: digest,
        detectedMimeType: detected.mimeType,
        detectedFileType: detected.extension,
      });
      timings.terminal_write_ms += Date.now() - phaseStartedAt;
      result = "passed";
      logSummary();
      return { attachmentId, scanStatus: "PASSED" as const, sha256: digest };
    } catch (error) {
      // A lost DB acknowledgement after the external scan must remain retryable. The
      // conditional write never downgrades an already terminal PASSED/REJECTED row.
      phaseStartedAt = Date.now();
      try { await this.repository.markScanFailed(attachment.id, "SCAN_PROCESSING_FAILED"); }
      catch { /* The Job lease/retry remains the durable recovery path. */ }
      finally { timings.terminal_write_ms += Date.now() - phaseStartedAt; }
      logSummary(error);
      throw error;
    }
  }
}
