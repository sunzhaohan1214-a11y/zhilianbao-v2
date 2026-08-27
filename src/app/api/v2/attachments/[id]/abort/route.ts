import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    assertTrustedMutationOrigin(request);
    const session = await requireRequestSession(request);
    const actor = await resolvePermissionActor(session);
    const { id } = await route.params;
    return apiSuccess(await getAttachmentRuntime().service.abort({ actor, attachmentId: id, context }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
