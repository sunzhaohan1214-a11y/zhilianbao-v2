import COS from "cos-nodejs-sdk-v5";
import sts, { type PolicyDescription } from "qcloud-cos-sts";
import { AttachmentError } from "../attachment-errors";
import type { StorageAdapter, StoredObjectHead, UploadAuthorization } from "./storage-adapter";

export const COS_UPLOAD_ACTIONS = [
  "name/cos:PutObject",
  "name/cos:HeadObject",
  "name/cos:InitiateMultipartUpload",
  "name/cos:ListMultipartUploads",
  "name/cos:UploadPart",
  "name/cos:CompleteMultipartUpload",
  "name/cos:ListParts",
  "name/cos:AbortMultipartUpload",
] as const;

const { getCredential, getPolicy } = sts;

export function buildCosUploadPolicy(input: {
  bucket: string;
  region: string;
  objectKey: string;
}): PolicyDescription {
  return getPolicy([{
    action: [...COS_UPLOAD_ACTIONS],
    bucket: input.bucket,
    region: input.region,
    prefix: input.objectKey,
  }]);
}

function contentLength(headers: COS.Headers | undefined): number {
  const value = headers?.["content-length"] ?? headers?.["Content-Length"];
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function isNotFound(error: unknown): boolean {
  const candidate = error as { code?: string; statusCode?: number };
  return candidate?.statusCode === 404 || ["NoSuchKey", "NotFound"].includes(candidate?.code ?? "");
}

function copySource(bucket: string, region: string, key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${bucket}.cos.${region}.myqcloud.com/${encoded}`;
}

export class CosStorageAdapter implements StorageAdapter {
  readonly bucket: string;
  readonly region: string;
  private readonly secretId: string;
  private readonly secretKey: string;
  private readonly cos: COS;

  constructor(input: { bucket: string; region: string; secretId: string; secretKey: string; cos?: COS }) {
    if (!input.bucket || !input.region || !input.secretId || !input.secretKey) {
      throw new AttachmentError("ATTACHMENT_STORAGE_UNAVAILABLE", "附件存储尚未配置");
    }
    this.bucket = input.bucket;
    this.region = input.region;
    this.secretId = input.secretId;
    this.secretKey = input.secretKey;
    this.cos = input.cos ?? new COS({ SecretId: input.secretId, SecretKey: input.secretKey });
  }

  async createUploadAuthorization(input: { objectKey: string; expiresInSeconds: number }): Promise<UploadAuthorization> {
    try {
      const data = await getCredential({
        secretId: this.secretId,
        secretKey: this.secretKey,
        durationSeconds: input.expiresInSeconds,
        policy: buildCosUploadPolicy({ bucket: this.bucket, region: this.region, objectKey: input.objectKey }),
      });
      return { type: "COS_STS", credentials: {
        tmpSecretId: data.credentials.tmpSecretId,
        tmpSecretKey: data.credentials.tmpSecretKey,
        sessionToken: data.credentials.sessionToken,
        startTime: data.startTime,
        expiredTime: data.expiredTime,
      } };
    } catch {
      throw new AttachmentError("ATTACHMENT_STORAGE_UNAVAILABLE", "暂时无法生成上传授权");
    }
  }

  async headObject(objectKey: string): Promise<StoredObjectHead> {
    try {
      const result = await this.cos.headObject({ Bucket: this.bucket, Region: this.region, Key: objectKey });
      return { exists: true, sizeBytes: contentLength(result.headers) };
    } catch (error) {
      if (isNotFound(error)) return { exists: false, sizeBytes: 0 };
      throw new AttachmentError("ATTACHMENT_STORAGE_UNAVAILABLE", "暂时无法读取附件存储状态");
    }
  }

  async promoteObject(stagingObjectKey: string, finalObjectKey: string): Promise<StoredObjectHead> {
    const finalHead = await this.headObject(finalObjectKey);
    if (!finalHead.exists) {
      const stagingHead = await this.headObject(stagingObjectKey);
      if (!stagingHead.exists) return stagingHead;
      try {
        await this.cos.putObjectCopy({
          Bucket: this.bucket,
          Region: this.region,
          Key: finalObjectKey,
          CopySource: copySource(this.bucket, this.region, stagingObjectKey),
          ACL: "private",
          MetadataDirective: "Copy",
        });
      } catch {
        throw new AttachmentError("ATTACHMENT_STORAGE_UNAVAILABLE", "暂时无法固化附件");
      }
    }
    await this.deleteObject(stagingObjectKey);
    return this.headObject(finalObjectKey);
  }

  async deleteObject(objectKey: string): Promise<void> {
    try {
      await this.cos.deleteObject({ Bucket: this.bucket, Region: this.region, Key: objectKey });
    } catch (error) {
      if (!isNotFound(error)) {
        throw new AttachmentError("ATTACHMENT_STORAGE_UNAVAILABLE", "暂时无法清理附件对象");
      }
    }
  }

  async readObject(objectKey: string): Promise<Buffer> {
    try {
      const result = await this.cos.getObject({ Bucket: this.bucket, Region: this.region, Key: objectKey });
      return Buffer.from(result.Body);
    } catch {
      throw new AttachmentError("ATTACHMENT_STORAGE_UNAVAILABLE", "暂时无法读取附件内容");
    }
  }

  async createSignedGetUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    try {
      return this.cos.getObjectUrl({
        Bucket: this.bucket,
        Region: this.region,
        Key: objectKey,
        Sign: true,
        Method: "GET",
        Expires: expiresInSeconds,
        Protocol: "https:",
      });
    } catch {
      throw new AttachmentError("ATTACHMENT_STORAGE_UNAVAILABLE", "暂时无法生成附件访问地址");
    }
  }
}
