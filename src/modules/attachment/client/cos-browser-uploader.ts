"use client";

import COS from "cos-js-sdk-v5";
import type { UploadAuthorization } from "../storage/storage-adapter";

export type BrowserUploadIntent = {
  bucket: string;
  region: string;
  stagingObjectKey: string;
  upload: UploadAuthorization;
};

export type AttachmentUploadTask = {
  promise: Promise<void>;
  pause(): void;
  resume(): void;
  cancel(): void;
  getTaskId(): string | undefined;
};

type CosUploadTaskClient = Pick<COS, "uploadFile" | "pauseTask" | "restartTask" | "cancelTask">;

export function createAttachmentUploadTask(
  cos: CosUploadTaskClient,
  params: COS.UploadFileParams,
): AttachmentUploadTask {
  let taskId: string | undefined;
  let desiredState: "running" | "paused" | "canceled" = "running";
  const originalOnTaskReady = params.onTaskReady;
  const promise = cos.uploadFile({
    ...params,
    onTaskReady(id) {
      taskId = id;
      if (desiredState === "paused") cos.pauseTask(id);
      if (desiredState === "canceled") cos.cancelTask(id);
      originalOnTaskReady?.(id);
    },
  }).then(() => undefined);

  return {
    promise,
    pause() {
      if (desiredState === "canceled") return;
      desiredState = "paused";
      if (taskId) cos.pauseTask(taskId);
    },
    resume() {
      if (desiredState === "canceled") return;
      desiredState = "running";
      if (taskId) cos.restartTask(taskId);
    },
    cancel() {
      if (desiredState === "canceled") return;
      desiredState = "canceled";
      if (taskId) cos.cancelTask(taskId);
    },
    getTaskId() {
      return taskId;
    },
  };
}

export function uploadAttachmentToCos(
  intent: BrowserUploadIntent,
  file: File,
  onProgress?: (progress: number) => void,
): AttachmentUploadTask {
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
  return createAttachmentUploadTask(cos, {
    Bucket: intent.bucket,
    Region: intent.region,
    Key: intent.stagingObjectKey,
    Body: file,
    SliceSize: 1024 * 1024,
    onProgress: ({ percent }) => onProgress?.(percent),
  });
}
