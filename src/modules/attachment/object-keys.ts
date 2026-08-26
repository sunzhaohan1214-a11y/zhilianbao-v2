import { randomBytes } from "node:crypto";

const SAFE_ATTACHMENT_ID = /^[0-9a-f-]{36}$/i;

function requireAttachmentId(attachmentId: string): void {
  if (!SAFE_ATTACHMENT_ID.test(attachmentId)) throw new Error("INVALID_ATTACHMENT_ID");
}

export function createStagingObjectKey(attachmentId: string, randomPart = randomBytes(18).toString("hex")): string {
  requireAttachmentId(attachmentId);
  return `incoming/${attachmentId}/${randomPart}`;
}

export function finalObjectKeyFromStaging(attachmentId: string, createdAt: Date, stagingObjectKey: string): string {
  requireAttachmentId(attachmentId);
  const randomPart = stagingObjectKey.split("/").at(-1);
  if (!randomPart || !/^[a-z0-9-]{12,128}$/i.test(randomPart)) throw new Error("INVALID_STAGING_KEY");
  const year = String(createdAt.getUTCFullYear()).padStart(4, "0");
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, "0");
  return `attachments/${year}/${month}/${attachmentId}/${randomPart}`;
}
