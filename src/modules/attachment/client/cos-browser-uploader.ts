import type { UploadAuthorization } from "../storage/storage-adapter";

// Compatibility types remain while forms are migrated to a CloudBase-package adapter.
// This module performs no COS request and cannot initialize a paid cloud SDK.
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

type LegacyTaskClient = {
  uploadFile(params: LegacyUploadParams): Promise<unknown>;
  pauseTask(id: string): void;
  restartTask(id: string): void;
  cancelTask(id: string): void;
};
type LegacyUploadParams = Record<string, unknown> & { onTaskReady?: (id: string) => void };

export function createAttachmentUploadTask(client: LegacyTaskClient, params: LegacyUploadParams): AttachmentUploadTask {
  let taskId: string | undefined;
  let desiredState: "running" | "paused" | "canceled" = "running";
  const originalOnTaskReady = params.onTaskReady;
  const promise = client.uploadFile({
    ...params,
    onTaskReady(id: string) {
      taskId = id;
      if (desiredState === "paused") client.pauseTask(id);
      if (desiredState === "canceled") client.cancelTask(id);
      originalOnTaskReady?.(id);
    },
  }).then(() => undefined);
  return {
    promise,
    pause() { if (desiredState !== "canceled") { desiredState = "paused"; if (taskId) client.pauseTask(taskId); } },
    resume() { if (desiredState !== "canceled") { desiredState = "running"; if (taskId) client.restartTask(taskId); } },
    cancel() { if (desiredState !== "canceled") { desiredState = "canceled"; if (taskId) client.cancelTask(taskId); } },
    getTaskId() { return taskId; },
  };
}

export function uploadAttachmentToCos(
  _intent: BrowserUploadIntent,
  _file: File,
  _onProgress?: (progress: number) => void,
): AttachmentUploadTask {
  void _intent; void _file; void _onProgress;
  throw new Error("额外付费 COS 上传已禁用；请使用本地测试存储或经批准的 CloudBase 套餐内存储");
}
