import type {
  AttachmentAccessAction,
  AttachmentPermissionLevel,
  Prisma,
} from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";

export type AttachmentWithLinks = Prisma.AttachmentGetPayload<{ include: { links: true } }>;

export class AttachmentRepository {
  private readonly prisma = getPrismaClient();

  createPending(input: {
    id: string;
    originalFilename: string;
    extension: string;
    declaredMimeType: string;
    expectedSizeBytes: bigint;
    bucket: string;
    region: string;
    stagingObjectKey: string;
    uploadedByPersonId: string;
    uploadExpiresAt: Date;
    permissionLevel: AttachmentPermissionLevel;
  }) {
    return this.prisma.attachment.create({ data: input });
  }

  findById(id: string): Promise<AttachmentWithLinks | null> {
    return this.prisma.attachment.findUnique({ where: { id }, include: { links: true } });
  }

  async markUploaded(input: {
    id: string;
    actorPersonId: string;
    finalObjectKey: string;
    actualSizeBytes: bigint;
    requestId?: string;
  }): Promise<AttachmentWithLinks> {
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.attachment.updateMany({
        where: { id: input.id, uploadStatus: "PENDING_UPLOAD" },
        data: {
          uploadStatus: "UPLOADED",
          scanStatus: "PENDING",
          actualSizeBytes: input.actualSizeBytes,
          objectKey: input.finalObjectKey,
          stagingObjectKey: null,
        },
      });
      if (changed.count === 0) return;
      await tx.jobTask.upsert({
        where: { idempotencyKey: `attachment-scan:${input.id}` },
        create: {
          jobType: "ATTACHMENT_SCAN",
          payloadJson: { attachmentId: input.id },
          status: "WAITING",
          idempotencyKey: `attachment-scan:${input.id}`,
          scheduledAt: new Date(),
        },
        update: {},
      });
      await tx.stateTransitionHistory.create({
        data: {
          entityType: "ATTACHMENT",
          entityId: input.id,
          fromState: "PENDING_UPLOAD",
          toState: "UPLOADED",
          actionCode: "ATTACHMENT_COMPLETE",
          actorPersonId: input.actorPersonId,
          requestId: input.requestId,
        },
      });
    });
    return this.prisma.attachment.findUniqueOrThrow({ where: { id: input.id }, include: { links: true } });
  }

  async markUploadFailed(id: string, reason: string): Promise<void> {
    await this.prisma.attachment.updateMany({
      where: { id, uploadStatus: "PENDING_UPLOAD" },
      data: { uploadStatus: "FAILED", scanStatus: "FAILED", scanReason: reason },
    });
  }

  async beginScan(id: string): Promise<boolean> {
    const result = await this.prisma.attachment.updateMany({
      where: { id, uploadStatus: "UPLOADED", scanStatus: { in: ["PENDING", "FAILED"] } },
      data: { scanStatus: "SCANNING", scanReason: null },
    });
    return result.count === 1;
  }

  async markScanPassed(input: {
    id: string;
    actualSizeBytes: bigint;
    sha256: string;
    detectedMimeType: string;
    detectedFileType: string;
  }): Promise<void> {
    const { id, ...data } = input;
    await this.prisma.attachment.update({
      where: { id },
      data: { ...data, scanStatus: "PASSED", scanReason: null },
    });
  }

  async markScanRejected(input: {
    id: string;
    reason: string;
    actualSizeBytes?: bigint;
    sha256?: string;
    detectedMimeType?: string;
    detectedFileType?: string;
  }): Promise<void> {
    await this.prisma.attachment.update({
      where: { id: input.id },
      data: {
        scanStatus: "REJECTED",
        scanReason: input.reason,
        actualSizeBytes: input.actualSizeBytes,
        sha256: input.sha256,
        detectedMimeType: input.detectedMimeType,
        detectedFileType: input.detectedFileType,
      },
    });
  }

  async markScanFailed(id: string, reason: string): Promise<void> {
    await this.prisma.attachment.update({
      where: { id },
      data: { scanStatus: "FAILED", scanReason: reason },
    });
  }

  async recordAccess(input: {
    attachmentId: string;
    personId: string;
    action: AttachmentAccessAction;
    ip: string;
    device?: string;
    requestId?: string;
  }): Promise<void> {
    await this.prisma.attachmentAccessLog.create({ data: input });
  }

  async abortTemporary(input: {
    id: string;
    actorPersonId: string;
    requestId?: string;
  }): Promise<AttachmentWithLinks | null> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM attachments WHERE id = ${input.id} FOR UPDATE
      `;
      if (rows.length !== 1) return null;
      const attachment = await tx.attachment.findUnique({ where: { id: input.id }, include: { links: true } });
      if (!attachment) return null;
      if (attachment.uploadStatus !== "ABORTED") {
        if (
          attachment.uploadedByPersonId !== input.actorPersonId
          || !attachment.isTemporary
          || attachment.links.length > 0
        ) return attachment;
        await tx.attachment.update({
          where: { id: input.id },
          data: { uploadStatus: "ABORTED", scanStatus: "FAILED", scanReason: "ABORTED_BY_UPLOADER" },
        });
        await tx.stateTransitionHistory.create({
          data: {
            entityType: "ATTACHMENT",
            entityId: input.id,
            fromState: attachment.uploadStatus,
            toState: "ABORTED",
            actionCode: "ATTACHMENT_ABORT",
            actorPersonId: input.actorPersonId,
            requestId: input.requestId,
          },
        });
      }
      return tx.attachment.findUnique({ where: { id: input.id }, include: { links: true } });
    });
  }

  async linkAttachment(input: {
    attachmentId: string;
    entityType: string;
    entityId: string;
    relationType: string;
    createdByPersonId: string;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM attachments WHERE id = ${input.attachmentId} FOR UPDATE
      `;
      if (rows.length !== 1) return null;
      const attachment = await tx.attachment.findUniqueOrThrow({ where: { id: input.attachmentId } });
      if (
        attachment.uploadStatus !== "UPLOADED"
        || !["PENDING", "SCANNING", "PASSED"].includes(attachment.scanStatus)
      ) return { attachment, link: null };
      const link = await tx.attachmentLink.upsert({
        where: {
          attachmentId_entityType_entityId_relationType: {
            attachmentId: input.attachmentId,
            entityType: input.entityType,
            entityId: input.entityId,
            relationType: input.relationType,
          },
        },
        create: input,
        update: {},
      });
      await tx.attachment.update({ where: { id: input.attachmentId }, data: { isTemporary: false } });
      return { attachment, link };
    });
  }

  findExpiredTemporary(now: Date, limit: number) {
    return this.prisma.attachment.findMany({
      where: {
        isTemporary: true,
        uploadExpiresAt: { lt: now },
        OR: [
          { uploadStatus: { in: ["PENDING_UPLOAD", "FAILED"] } },
          { uploadStatus: "UPLOADED", scanStatus: { in: ["REJECTED", "FAILED"] } },
        ],
        links: { none: {} },
      },
      orderBy: { uploadExpiresAt: "asc" },
      take: limit,
      include: { links: true },
    });
  }
}
