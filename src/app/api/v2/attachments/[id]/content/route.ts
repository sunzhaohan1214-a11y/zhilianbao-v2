import type { NextRequest } from "next/server";
import { apiError } from "@/lib/api/response";
import { requireRequestSession } from "@/lib/auth/current-session";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function GET(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const session = await requireRequestSession(request);
    const actor = await resolvePermissionActor(session);
    const { id } = await route.params;
    const content = await getAttachmentRuntime().service.readPreviewContent({ actor, attachmentId: id, context });
    return new Response(new Uint8Array(content.body), {
      headers: {
        "cache-control": "private, max-age=60",
        "content-type": content.mimeType,
        "content-disposition": "inline",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
