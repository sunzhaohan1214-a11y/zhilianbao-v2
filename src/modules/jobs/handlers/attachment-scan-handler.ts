import { AttachmentError } from "@/modules/attachment/attachment-errors";
import type { AttachmentScanService } from "@/modules/attachment/attachment-scan-service";
import { PermanentJobError, RetryableJobError } from "../errors";
import type { JobHandler } from "../handler-registry";

export class AttachmentScanJobHandler implements JobHandler<"ATTACHMENT_SCAN"> {
  constructor(private readonly service: AttachmentScanService) {}

  async handle(payload: { attachmentId: string }): Promise<void> {
    try {
      await this.service.processAttachmentScan(payload.attachmentId);
    } catch (error) {
      if (error instanceof AttachmentError) {
        if (["ATTACHMENT_SCANNER_UNAVAILABLE", "ATTACHMENT_STORAGE_UNAVAILABLE"].includes(error.code)) {
          throw new RetryableJobError(error.code, "Attachment scan dependency is temporarily unavailable", { cause: error });
        }
        throw new PermanentJobError(error.code, "Attachment scan cannot be completed", { cause: error });
      }
      throw new RetryableJobError("ATTACHMENT_SCAN_TRANSIENT", "Attachment scan failed transiently", { cause: error });
    }
  }
}
