import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireRequestSession } from "@/lib/auth/current-session";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { accessActionSchema } from "@/modules/attachment/schemas";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function GET(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const session = await requireRequestSession(request);
    const actor = await resolvePermissionActor(session);
    const action = accessActionSchema.parse(request.nextUrl.searchParams.get("action"));
    const { id } = await route.params;
    return apiSuccess(await getAttachmentRuntime().service.access({
      actor,
      attachmentId: id,
      action: action === "preview" ? "PREVIEW" : "DOWNLOAD",
      context,
    }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
