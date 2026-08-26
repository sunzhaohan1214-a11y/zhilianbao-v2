"use client";

import COS from "cos-js-sdk-v5";
import type { UploadAuthorization } from "../storage/storage-adapter";

export type BrowserUploadIntent = {
  bucket: string;
  region: string;
  stagingObjectKey: string;
  upload: UploadAuthorization;
};

export async function uploadAttachmentToCos(
  intent: BrowserUploadIntent,
  file: File,
  onProgress?: (progress: number) => void,
): Promise<void> {
  if (intent.upload.type !== "COS_STS") throw new Error("COS_STS_UPLOAD_REQUIRED");
  const credentials = intent.upload.credentials;
  const cos = new COS({
    getAuthorization(_options, callback) {
      callback({
        TmpSecretId: credentials.tmpSecretId,
        TmpSecretKey: credentials.tmpSecretKey,
        SecurityToken: credentials.sessionToken,
        StartTime: credentials.startTime,
        ExpiredTime: credentials.expiredTime,
        ScopeLimit: true,
      });
    },
  });
  await cos.uploadFile({
    Bucket: intent.bucket,
    Region: intent.region,
    Key: intent.stagingObjectKey,
    Body: file,
    SliceSize: 1024 * 1024,
    onProgress: ({ percent }) => onProgress?.(percent),
  });
}
