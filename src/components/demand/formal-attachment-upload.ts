import type { UploadAuthorization } from "@/modules/attachment/storage/storage-adapter";
import { waitForAttachmentScan } from "@/modules/attachment/client/wait-for-attachment-scan";

type InternalAttachmentIntent = { attachmentId: string; upload: UploadAuthorization };

async function fileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

export async function uploadFormalAttachments(files: readonly File[]): Promise<string[]> {
  const attachmentIds: string[] = [];
  for (const file of files) {
    const intentResponse = await fetch("/api/v2/attachments/upload-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        declaredMimeType: file.type || "application/octet-stream",
        expectedSizeBytes: file.size,
      }),
    });
    const intentPayload = await intentResponse.json();
    if (!intentResponse.ok) throw new Error(intentPayload.error?.message ?? "附件上传申请失败");
    const intent = intentPayload.data as InternalAttachmentIntent;
    const testResponse = await fetch(`/api/v2/test/attachments/${intent.attachmentId}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base64: await fileAsBase64(file) }),
    });
    if (!testResponse.ok) throw new Error("本地附件上传失败");
    const completeResponse = await fetch(`/api/v2/attachments/${intent.attachmentId}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const completePayload = await completeResponse.json();
    if (!completeResponse.ok) throw new Error(completePayload.error?.message ?? "附件确认失败");
    const scanResponse = await fetch(`/api/v2/test/attachments/${intent.attachmentId}/scan`, { method: "POST" });
    if (!scanResponse.ok) throw new Error("本地附件安全扫描失败");
    await waitForAttachmentScan(async () => {
      const response = await fetch(`/api/v2/attachments/${intent.attachmentId}/complete`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "附件状态查询失败");
      return payload.data;
    });
    attachmentIds.push(intent.attachmentId);
  }
  return attachmentIds;
}
