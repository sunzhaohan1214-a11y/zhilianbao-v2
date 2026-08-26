import { AttachmentRepository } from "./repository/attachment-repository";
import type { StorageAdapter } from "./storage/storage-adapter";

export class AttachmentCleanupService {
  constructor(private readonly repository: AttachmentRepository, private readonly storage: StorageAdapter) {}

  async cleanupExpiredTemporaryAttachments(now = new Date(), limit = 100): Promise<number> {
    const candidates = await this.repository.findExpiredTemporary(now, Math.min(Math.max(limit, 1), 500));
    let cleaned = 0;
    for (const attachment of candidates) {
      const aborted = await this.repository.abortTemporary({
        id: attachment.id,
        actorPersonId: attachment.uploadedByPersonId,
        requestId: "attachment-cleanup",
      });
      if (aborted?.uploadStatus !== "ABORTED") continue;
      if (aborted.stagingObjectKey) await this.storage.deleteObject(aborted.stagingObjectKey);
      if (aborted.objectKey) await this.storage.deleteObject(aborted.objectKey);
      cleaned += 1;
    }
    return cleaned;
  }
}
