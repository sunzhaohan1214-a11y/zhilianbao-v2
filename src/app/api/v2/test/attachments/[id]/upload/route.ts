import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { AttachmentError } from "@/modules/attachment/attachment-errors";
import { getAttachmentRuntime, requireTestStorageAdapter } from "@/modules/attachment/runtime";
import { testUploadSchema } from "@/modules/attachment/schemas";
import { authorizeActor } from "@/modules/permissions/authorization";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    if (process.env.APP_ENV !== "test") throw new AttachmentError("ATTACHMENT_NOT_FOUND", "附件不存在");
    assertTrustedMutationOrigin(request);
    const actor = await resolvePermissionActor(await requireRequestSession(request));
    const { id } = await route.params;
    const attachment = await getAttachmentRuntime().repository.findById(id);
    if (!attachment?.stagingObjectKey) throw new AttachmentError("ATTACHMENT_NOT_FOUND", "附件不存在");
    await authorizeActor({
      actor,
      action: "attachment.temporary_self_access",
      resource: { resourceType: "attachment", requiredScope: "SELF", ownerPersonId: attachment.uploadedByPersonId },
    });
    const input = testUploadSchema.parse(await request.json());
    requireTestStorageAdapter().putObjectForTest(attachment.stagingObjectKey, Buffer.from(input.base64, "base64"));
    return apiSuccess({}, context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
