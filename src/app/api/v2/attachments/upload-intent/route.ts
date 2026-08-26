import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { uploadIntentSchema } from "@/modules/attachment/schemas";

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    assertTrustedMutationOrigin(request);
    const session = await requireRequestSession(request);
    const actor = await resolvePermissionActor(session);
    const input = uploadIntentSchema.parse(await request.json());
    return apiSuccess(await getAttachmentRuntime().service.createUploadIntent({ actor, ...input }), context.requestId, 201);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
