import type { JobRepository } from "@/modules/jobs/job-repository";
import type { OutboxHandler } from "../outbox-handler-registry";

export class AttachmentUploadedOutboxHandler implements OutboxHandler<"ATTACHMENT_UPLOADED"> {
  constructor(private readonly jobs: JobRepository) {}

  async handle(payload: { attachmentId: string }, context: Parameters<OutboxHandler<"ATTACHMENT_UPLOADED">["handle"]>[1]) {
    await this.jobs.enqueue({
      jobType: "ATTACHMENT_SCAN",
      payload: { attachmentId: payload.attachmentId },
      idempotencyKey: `attachment-scan:${payload.attachmentId}`,
    }, context.tx);
  }
}
