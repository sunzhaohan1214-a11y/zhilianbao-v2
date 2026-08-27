import type { AttachmentCleanupService } from "@/modules/attachment/attachment-cleanup-service";
import { RetryableJobError } from "../errors";
import type { JobHandler } from "../handler-registry";

export class AttachmentCleanupJobHandler implements JobHandler<"ATTACHMENT_TEMP_CLEANUP"> {
  constructor(private readonly service: AttachmentCleanupService) {}

  async handle(payload: { limit?: number }): Promise<void> {
    try {
      await this.service.cleanupExpiredTemporaryAttachments(new Date(), payload.limit ?? 100);
    } catch (error) {
      throw new RetryableJobError("ATTACHMENT_CLEANUP_TRANSIENT", "Attachment cleanup failed transiently", { cause: error });
    }
  }
}
