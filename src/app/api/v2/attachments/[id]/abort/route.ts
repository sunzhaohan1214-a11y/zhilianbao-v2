import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { writeLog } from "@/lib/logging/logger";
import { markSafeErrorLogged, safeErrorMetadata } from "@/lib/logging/safe-error";

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const startedAt = Date.now();
  let stage = "origin_validation";
  const context = buildAuthRequestContext(request);
  try {
    assertTrustedMutationOrigin(request);
    stage = "session";
    const session = await requireRequestSession(request);
    stage = "permission_actor";
    const actor = await resolvePermissionActor(session);
    stage = "route_params";
    const { id } = await route.params;
    stage = "abort_service";
    const result = await getAttachmentRuntime().service.abort({ actor, attachmentId: id, context });
    stage = "complete";
    return apiSuccess(result, context.requestId);
  } catch (error) {
    const safe = safeErrorMetadata(error);
    const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500;
    writeLog(status >= 400 && status < 500 ? "warn" : "error", { requestId: context.requestId, module: "attachment", route: "/api/v2/attachments/:id/abort", result: "abort_failed", stage, durationMs: Date.now() - startedAt, errorCode: safe.errorCode, errorClass: safe.errorClass });
    markSafeErrorLogged(error);
    return apiError(error, context.requestId);
  }
}
