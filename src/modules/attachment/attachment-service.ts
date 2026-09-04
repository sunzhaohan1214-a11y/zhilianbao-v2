import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AttachmentAccessAction, AttachmentPermissionLevel } from "@/generated/prisma/client";
import type { PermissionActor } from "@/modules/permissions/types";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { AuthRequestContext } from "@/modules/identity/request-context";
import type { AttachmentConfig } from "./attachment-config";
import { AttachmentError } from "./attachment-errors";
import { MAX_ATTACHMENT_SIZE_BYTES, validateIntentFile } from "./file-policy";
import { createStagingObjectKey, finalObjectKeyFromStaging } from "./object-keys";
import { AttachmentParentAuthorizerRegistry } from "./parent-authorization";
import { AttachmentRepository, type AttachmentWithLinks } from "./repository/attachment-repository";
import type { StorageAdapter } from "./storage/storage-adapter";

function attachmentSummary(attachment: AttachmentWithLinks) {
  return {
    attachmentId: attachment.id,
    uploadStatus: attachment.uploadStatus,
    scanStatus: attachment.scanStatus,
    actualSizeBytes: attachment.actualSizeBytes === null ? null : Number(attachment.actualSizeBytes),
  };
}

export class AttachmentService {
  constructor(
    private readonly repository: AttachmentRepository,
    private readonly storage: StorageAdapter,
    private readonly parentAuthorizers: AttachmentParentAuthorizerRegistry,
    private readonly config: AttachmentConfig,
  ) {}

  async createUploadIntent(input: {
    actor: PermissionActor;
    filename: string;
    declaredMimeType: string;
    expectedSizeBytes: number;
    permissionLevel?: AttachmentPermissionLevel;
  }) {
    await authorizeActor({ actor: input.actor, action: "attachment.upload" });
    const file = validateIntentFile(input);
    const attachmentId = randomUUID();
    const stagingObjectKey = createStagingObjectKey(attachmentId);
    const uploadExpiresAt = new Date(Date.now() + this.config.uploadTtlSeconds * 1000);
    await this.repository.createPending({
      id: attachmentId,
      originalFilename: file.originalFilename,
      extension: file.extension,
      declaredMimeType: file.declaredMimeType,
      expectedSizeBytes: BigInt(file.expectedSizeBytes),
      bucket: this.storage.bucket,
      region: this.storage.region,
      stagingObjectKey,
      uploadedByPersonId: input.actor.personId,
      uploadExpiresAt,
      permissionLevel: input.permissionLevel ?? "PARENT_AUTHORIZED",
    });
    try {
      const upload = await this.storage.createUploadAuthorization({
        objectKey: stagingObjectKey,
        expiresInSeconds: this.config.uploadTtlSeconds,
      });
      return {
        attachmentId,
        upload,
        bucket: this.storage.bucket,
        region: this.storage.region,
        stagingObjectKey,
        expiresAt: uploadExpiresAt.toISOString(),
        maxSize: MAX_ATTACHMENT_SIZE_BYTES,
      };
    } catch (error) {
      await this.repository.markUploadFailed(attachmentId, "UPLOAD_AUTHORIZATION_FAILED");
      throw error;
    }
  }

  async createPublicUploadIntent(input: {
    filename: string;
    declaredMimeType: string;
    expectedSizeBytes: number;
    responsibleAreaId: string;
  }) {
    const file = validateIntentFile(input);
    const attachmentId = randomUUID();
    const uploadToken = randomBytes(32).toString("base64url");
    const publicUploadTokenHash = createHash("sha256").update(uploadToken).digest("hex");
    const stagingObjectKey = createStagingObjectKey(attachmentId);
    const uploadExpiresAt = new Date(Date.now() + this.config.uploadTtlSeconds * 1000);
    await this.repository.createPending({
      id: attachmentId,
      originalFilename: file.originalFilename,
      extension: file.extension,
      declaredMimeType: file.declaredMimeType,
      expectedSizeBytes: BigInt(file.expectedSizeBytes),
      bucket: this.storage.bucket,
      region: this.storage.region,
      stagingObjectKey,
      publicUploadTokenHash,
      publicAreaId: input.responsibleAreaId,
      uploadExpiresAt,
      permissionLevel: "PARENT_AUTHORIZED",
    });
    try {
      const upload = await this.storage.createUploadAuthorization({
        objectKey: stagingObjectKey,
        expiresInSeconds: this.config.uploadTtlSeconds,
      });
      return {
        attachmentId,
        uploadToken,
        upload,
        bucket: this.storage.bucket,
        region: this.storage.region,
        stagingObjectKey,
        expiresAt: uploadExpiresAt.toISOString(),
        maxSize: MAX_ATTACHMENT_SIZE_BYTES,
      };
    } catch (error) {
      await this.repository.markUploadFailed(attachmentId, "UPLOAD_AUTHORIZATION_FAILED");
      throw error;
    }
  }

  async complete(input: { actor: PermissionActor; attachmentId: string; context?: AuthRequestContext }) {
    await authorizeActor({ actor: input.actor, action: "attachment.temporary_self_access" });
    const attachment = await this.requireAttachment(input.attachmentId);
    if (!attachment.uploadedByPersonId) throw new AttachmentError("ATTACHMENT_FORBIDDEN", "公开临时附件不能通过内部接口操作");
    await authorizeActor({
      actor: input.actor,
      action: "attachment.temporary_self_access",
      resource: { resourceType: "attachment", requiredScope: "SELF", ownerPersonId: attachment.uploadedByPersonId },
    });
    if (attachment.uploadStatus === "UPLOADED") return attachmentSummary(attachment);
    if (attachment.uploadStatus !== "PENDING_UPLOAD" || !attachment.stagingObjectKey) {
      throw new AttachmentError("ATTACHMENT_STATE_CONFLICT", "附件当前状态不能确认上传");
    }

    const finalObjectKey = finalObjectKeyFromStaging(attachment.id, attachment.createdAt, attachment.stagingObjectKey);
    const [stagingHead, finalHead] = await Promise.all([
      this.storage.headObject(attachment.stagingObjectKey),
      this.storage.headObject(finalObjectKey),
    ]);
    const actualHead = finalHead.exists ? finalHead : stagingHead;
    if (!actualHead.exists) {
      throw new AttachmentError("ATTACHMENT_VALIDATION_FAILED", "尚未找到已上传的文件");
    }
    if (actualHead.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES) {
      await this.failInvalidUpload({
        attachmentId: attachment.id,
        stagingObjectKey: attachment.stagingObjectKey,
        finalObjectKey,
        stagingExists: stagingHead.exists,
        finalExists: finalHead.exists,
        reason: "ACTUAL_SIZE_EXCEEDS_LIMIT",
      });
      throw new AttachmentError("ATTACHMENT_TOO_LARGE", "单个附件不能超过 50MB");
    }
    if (actualHead.sizeBytes !== Number(attachment.expectedSizeBytes)) {
      await this.failInvalidUpload({
        attachmentId: attachment.id,
        stagingObjectKey: attachment.stagingObjectKey,
        finalObjectKey,
        stagingExists: stagingHead.exists,
        finalExists: finalHead.exists,
        reason: "ACTUAL_SIZE_MISMATCH",
      });
      throw new AttachmentError("ATTACHMENT_VALIDATION_FAILED", "文件实际大小与上传申请不一致");
    }
    const promoted = await this.storage.promoteObject(attachment.stagingObjectKey, finalObjectKey);
    if (!promoted.exists || promoted.sizeBytes !== actualHead.sizeBytes) {
      throw new AttachmentError("ATTACHMENT_STORAGE_UNAVAILABLE", "附件固化校验失败");
    }
    const updated = await this.repository.markUploaded({
      id: attachment.id,
      actorPersonId: input.actor.personId,
      finalObjectKey,
      actualSizeBytes: BigInt(promoted.sizeBytes),
      requestId: input.context?.requestId,
    });
    if (updated.uploadStatus !== "UPLOADED") {
      await this.storage.deleteObject(finalObjectKey);
      throw new AttachmentError("ATTACHMENT_STATE_CONFLICT", "附件状态已变化，不能确认上传");
    }
    return attachmentSummary(updated);
  }

  async completePublic(input: { attachmentId: string; uploadToken: string; context?: AuthRequestContext }) {
    const attachment = await this.requireAttachment(input.attachmentId);
    const actualHash = createHash("sha256").update(input.uploadToken).digest();
    const expectedHash = attachment.publicUploadTokenHash
      ? Buffer.from(attachment.publicUploadTokenHash, "hex")
      : Buffer.alloc(0);
    if (
      attachment.uploadedByPersonId !== null
      || expectedHash.length !== actualHash.length
      || !timingSafeEqual(expectedHash, actualHash)
    ) {
      throw new AttachmentError("ATTACHMENT_FORBIDDEN", "公开附件凭证无效");
    }
    if (!attachment.uploadExpiresAt || attachment.uploadExpiresAt <= new Date()) {
      throw new AttachmentError("ATTACHMENT_FORBIDDEN", "公开附件凭证已过期");
    }
    if (attachment.uploadStatus === "UPLOADED") return attachmentSummary(attachment);
    if (attachment.uploadStatus !== "PENDING_UPLOAD" || !attachment.stagingObjectKey) {
      throw new AttachmentError("ATTACHMENT_STATE_CONFLICT", "附件当前状态不能确认上传");
    }
    const finalObjectKey = finalObjectKeyFromStaging(attachment.id, attachment.createdAt, attachment.stagingObjectKey);
    const [stagingHead, finalHead] = await Promise.all([
      this.storage.headObject(attachment.stagingObjectKey),
      this.storage.headObject(finalObjectKey),
    ]);
    const actualHead = finalHead.exists ? finalHead : stagingHead;
    if (!actualHead.exists) throw new AttachmentError("ATTACHMENT_VALIDATION_FAILED", "尚未找到已上传的文件");
    if (actualHead.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES || actualHead.sizeBytes !== Number(attachment.expectedSizeBytes)) {
      await this.failInvalidUpload({
        attachmentId: attachment.id,
        stagingObjectKey: attachment.stagingObjectKey,
        finalObjectKey,
        stagingExists: stagingHead.exists,
        finalExists: finalHead.exists,
        reason: actualHead.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES ? "ACTUAL_SIZE_EXCEEDS_LIMIT" : "ACTUAL_SIZE_MISMATCH",
      });
      throw new AttachmentError(
        actualHead.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES ? "ATTACHMENT_TOO_LARGE" : "ATTACHMENT_VALIDATION_FAILED",
        actualHead.sizeBytes > MAX_ATTACHMENT_SIZE_BYTES ? "单个附件不能超过 50MB" : "文件实际大小与上传申请不一致",
      );
    }
    const promoted = await this.storage.promoteObject(attachment.stagingObjectKey, finalObjectKey);
    if (!promoted.exists || promoted.sizeBytes !== actualHead.sizeBytes) {
      throw new AttachmentError("ATTACHMENT_STORAGE_UNAVAILABLE", "附件固化校验失败");
    }
    const updated = await this.repository.markUploaded({
      id: attachment.id,
      finalObjectKey,
      actualSizeBytes: BigInt(promoted.sizeBytes),
      requestId: input.context?.requestId,
    });
    if (updated.uploadStatus !== "UPLOADED") {
      await this.storage.deleteObject(finalObjectKey);
      throw new AttachmentError("ATTACHMENT_STATE_CONFLICT", "附件状态已变化，不能确认上传");
    }
    return attachmentSummary(updated);
  }

  async access(input: {
    actor: PermissionActor;
    attachmentId: string;
    action: AttachmentAccessAction;
    context: AuthRequestContext;
  }) {
    await authorizeActor({ actor: input.actor, action: "attachment.temporary_self_access" });
    const attachment = await this.requireAttachment(input.attachmentId);
    if (attachment.isTemporary) {
      if (!attachment.uploadedByPersonId) throw new AttachmentError("ATTACHMENT_FORBIDDEN", "公开临时附件不能通过内部接口访问");
      await authorizeActor({
        actor: input.actor,
        action: "attachment.temporary_self_access",
        resource: { resourceType: "attachment", requiredScope: "SELF", ownerPersonId: attachment.uploadedByPersonId },
      });
    } else {
      const allowed = await this.parentAuthorizers.authorizeAll({
        actor: input.actor,
        links: attachment.links,
        action: input.action,
      });
      if (!allowed) throw new AttachmentError("ATTACHMENT_FORBIDDEN", "无权访问此附件");
    }
    if (attachment.uploadStatus !== "UPLOADED" || attachment.scanStatus !== "PASSED" || !attachment.objectKey) {
      throw new AttachmentError("ATTACHMENT_STATE_CONFLICT", "文件尚未通过安全检查");
    }

    const url = await this.storage.createSignedGetUrl(attachment.objectKey, this.config.signedUrlTtlSeconds);
    await this.repository.recordAccess({
      attachmentId: attachment.id,
      personId: input.actor.personId,
      action: input.action,
      ip: input.context.ip,
      device: input.context.deviceName,
      requestId: input.context.requestId,
    });
    return {
      url,
      expiresAt: new Date(Date.now() + this.config.signedUrlTtlSeconds * 1000).toISOString(),
      ttlSeconds: this.config.signedUrlTtlSeconds,
    };
  }

  async readPreviewContent(input: {
    actor: PermissionActor;
    attachmentId: string;
    context: AuthRequestContext;
  }) {
    await authorizeActor({ actor: input.actor, action: "attachment.temporary_self_access" });
    const attachment = await this.requireAttachment(input.attachmentId);
    if (attachment.isTemporary) throw new AttachmentError("ATTACHMENT_FORBIDDEN", "临时附件不能通过正式预览地址访问");
    const allowed = await this.parentAuthorizers.authorizeAll({
      actor: input.actor,
      links: attachment.links,
      action: "PREVIEW",
    });
    if (!allowed) throw new AttachmentError("ATTACHMENT_FORBIDDEN", "无权访问此附件");
    if (attachment.uploadStatus !== "UPLOADED" || attachment.scanStatus !== "PASSED" || !attachment.objectKey) {
      throw new AttachmentError("ATTACHMENT_STATE_CONFLICT", "文件尚未通过安全检查");
    }
    const body = await this.storage.readObject(attachment.objectKey);
    await this.repository.recordAccess({
      attachmentId: attachment.id,
      personId: input.actor.personId,
      action: "PREVIEW",
      ip: input.context.ip,
      device: input.context.deviceName,
      requestId: input.context.requestId,
    });
    return {
      body,
      mimeType: attachment.detectedMimeType ?? attachment.declaredMimeType,
    };
  }

  async abort(input: { actor: PermissionActor; attachmentId: string; context?: AuthRequestContext }) {
    const attachment = await this.requireAttachment(input.attachmentId);
    if (!attachment.uploadedByPersonId) throw new AttachmentError("ATTACHMENT_FORBIDDEN", "公开临时附件不能通过内部接口操作");
    await authorizeActor({
      actor: input.actor,
      action: "attachment.abort_self",
      resource: { resourceType: "attachment", requiredScope: "SELF", ownerPersonId: attachment.uploadedByPersonId },
    });
    if (!attachment.isTemporary || attachment.links.length > 0) {
      throw new AttachmentError("ATTACHMENT_FORBIDDEN", "已正式使用的附件不能中止");
    }
    const aborted = await this.repository.abortTemporary({
      id: attachment.id,
      actorPersonId: input.actor.personId,
      requestId: input.context?.requestId,
    });
    if (!aborted || aborted.uploadStatus !== "ABORTED") {
      throw new AttachmentError("ATTACHMENT_STATE_CONFLICT", "附件当前状态不能中止");
    }
    if (aborted.stagingObjectKey) await this.storage.deleteObject(aborted.stagingObjectKey);
    if (aborted.objectKey) await this.storage.deleteObject(aborted.objectKey);
    return { attachmentId: attachment.id, uploadStatus: "ABORTED" as const };
  }

  private async requireAttachment(id: string): Promise<AttachmentWithLinks> {
    const attachment = await this.repository.findById(id);
    if (!attachment) throw new AttachmentError("ATTACHMENT_NOT_FOUND", "附件不存在");
    return attachment;
  }

  private async failInvalidUpload(input: {
    attachmentId: string;
    stagingObjectKey: string;
    finalObjectKey: string;
    stagingExists: boolean;
    finalExists: boolean;
    reason: string;
  }): Promise<void> {
    let cleanupError: unknown;
    try {
      await Promise.all([
        input.stagingExists ? this.storage.deleteObject(input.stagingObjectKey) : Promise.resolve(),
        input.finalExists ? this.storage.deleteObject(input.finalObjectKey) : Promise.resolve(),
      ]);
    } catch (error) {
      cleanupError = error;
    }
    await this.repository.markUploadFailed(input.attachmentId, input.reason);
    if (cleanupError) throw cleanupError;
  }
}
