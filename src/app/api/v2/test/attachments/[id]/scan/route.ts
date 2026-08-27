import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { AttachmentError } from "@/modules/attachment/attachment-errors";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
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
    if (!attachment) throw new AttachmentError("ATTACHMENT_NOT_FOUND", "附件不存在");
    if (!attachment.uploadedByPersonId) throw new AttachmentError("ATTACHMENT_FORBIDDEN", "无权操作此附件");
    await authorizeActor({
      actor,
      action: "attachment.temporary_self_access",
      resource: { resourceType: "attachment", requiredScope: "SELF", ownerPersonId: attachment.uploadedByPersonId },
    });
    return apiSuccess(await getAttachmentRuntime().scanService.processAttachmentScan(id), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
