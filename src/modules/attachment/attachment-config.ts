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

export function loadAttachmentConfig(environment: NodeJS.ProcessEnv = process.env): AttachmentConfig {
  const bucket = environment.COS_BUCKET?.trim();
  const region = environment.COS_REGION?.trim();
  if (!bucket || !region) {
    throw new AttachmentError("ATTACHMENT_STORAGE_UNAVAILABLE", "附件存储尚未配置");
  }
  return {
    bucket,
    region,
    uploadTtlSeconds: positiveInteger(environment.ATTACHMENT_UPLOAD_TTL_SECONDS, 900, 900),
    signedUrlTtlSeconds: positiveInteger(environment.ATTACHMENT_SIGNED_URL_TTL_SECONDS, 300, 900),
  };
}
