import { createHash, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiSuccess } from "@/lib/api/response";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { AttachmentError } from "@/modules/attachment/attachment-errors";
import { getAttachmentRuntime, requireTestStorageAdapter } from "@/modules/attachment/runtime";
import { testUploadSchema } from "@/modules/attachment/schemas";

const publicTestUploadSchema = testUploadSchema.extend({
  uploadToken: z.string().min(32).max(256),
}).strict();

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    if (process.env.APP_ENV !== "test") throw new AttachmentError("ATTACHMENT_NOT_FOUND", "附件不存在");
    assertTrustedMutationOrigin(request);
    const { id } = await route.params;
    const input = publicTestUploadSchema.parse(await request.json());
    const attachment = await getAttachmentRuntime().repository.findById(id);
    const actualHash = createHash("sha256").update(input.uploadToken).digest();
    const expectedHash = attachment?.publicUploadTokenHash
      ? Buffer.from(attachment.publicUploadTokenHash, "hex")
      : Buffer.alloc(0);
    if (
      !attachment?.stagingObjectKey
      || attachment.uploadedByPersonId !== null
      || !attachment.uploadExpiresAt
      || attachment.uploadExpiresAt <= new Date()
      || expectedHash.length !== actualHash.length
      || !timingSafeEqual(expectedHash, actualHash)
    ) {
      throw new AttachmentError("ATTACHMENT_FORBIDDEN", "公开附件凭证无效");
    }
    requireTestStorageAdapter().putObjectForTest(attachment.stagingObjectKey, Buffer.from(input.base64, "base64"));
    return apiSuccess({}, context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
