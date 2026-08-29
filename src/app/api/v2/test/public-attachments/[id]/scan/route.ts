import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/response";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { AttachmentError } from "@/modules/attachment/attachment-errors";
import { getAttachmentRuntime, testMemoryAttachmentStorageEnabled } from "@/modules/attachment/runtime";

const publicTestScanSchema = z.object({
  uploadToken: z.string().min(32).max(256),
}).strict();

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    if (!testMemoryAttachmentStorageEnabled()) {
      throw new AttachmentError("ATTACHMENT_NOT_FOUND", "附件不存在");
    }
    assertTrustedMutationOrigin(request);
    const { id } = await route.params;
    const { uploadToken } = publicTestScanSchema.parse(await request.json());
    const attachment = await getAttachmentRuntime().repository.findById(id);
    const actualHash = createHash("sha256").update(uploadToken).digest();
    const expectedHash = attachment?.publicUploadTokenHash
      ? Buffer.from(attachment.publicUploadTokenHash, "hex")
      : Buffer.alloc(0);
    if (
      !attachment
      || attachment.uploadedByPersonId !== null
      || attachment.uploadStatus !== "UPLOADED"
      || !attachment.uploadExpiresAt
      || attachment.uploadExpiresAt <= new Date()
      || expectedHash.length !== actualHash.length
      || !timingSafeEqual(expectedHash, actualHash)
    ) {
      throw new AttachmentError("ATTACHMENT_FORBIDDEN", "公开附件凭证无效");
    }
    return apiSuccess(await getAttachmentRuntime().scanService.processAttachmentScan(id), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
