import { AttachmentError } from "./attachment-errors";
import { AttachmentRepository } from "./repository/attachment-repository";

export class AttachmentLinkService {
  constructor(private readonly repository: AttachmentRepository) {}

  async linkAttachment(input: {
    attachmentId: string;
    entityType: string;
    entityId: string;
    relationType: string;
    authorizedDomainActorPersonId: string;
  }) {
    const result = await this.repository.linkAttachment({
      attachmentId: input.attachmentId,
      entityType: input.entityType,
      entityId: input.entityId,
      relationType: input.relationType,
      createdByPersonId: input.authorizedDomainActorPersonId,
    });
    if (!result) throw new AttachmentError("ATTACHMENT_NOT_FOUND", "附件不存在");
    if (!result.link) throw new AttachmentError("ATTACHMENT_STATE_CONFLICT", "附件当前状态不能建立正式关联");
    return result.link;
  }
}
