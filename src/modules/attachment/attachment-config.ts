import { AttachmentError } from "./attachment-errors";

export type AttachmentConfig = {
  bucket: string;
  region: string;
  uploadTtlSeconds: number;
  signedUrlTtlSeconds: number;
};

function positiveInteger(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new AttachmentError("ATTACHMENT_INVALID_INPUT", "附件服务有效期配置不正确");
  }
  return parsed;
}

export function loadAttachmentConfig(environment: Record<string, string | undefined> = process.env): AttachmentConfig {
  const bucket = environment.ATTACHMENT_BUCKET?.trim() || "local-private-attachments";
  const region = environment.ATTACHMENT_REGION?.trim() || "local";
  return {
    bucket,
    region,
    uploadTtlSeconds: positiveInteger(environment.ATTACHMENT_UPLOAD_TTL_SECONDS, 900, 900),
    signedUrlTtlSeconds: positiveInteger(environment.ATTACHMENT_SIGNED_URL_TTL_SECONDS, 300, 900),
  };
}
