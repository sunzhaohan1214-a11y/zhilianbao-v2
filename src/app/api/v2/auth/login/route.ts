import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { setAuthCookies } from "@/lib/auth/cookies";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext, getDeviceId } from "@/lib/auth/request-context";
import { login } from "@/modules/identity/auth-service";
import { loginSchema } from "@/modules/identity/schemas";
import { writeLog } from "@/lib/logging/logger";
import { markSafeErrorLogged, safeErrorMetadata, safeErrorStage } from "@/lib/logging/safe-error";

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  let stage = "origin_validation";
  const deviceId = getDeviceId(request);
  const context = buildAuthRequestContext(request, deviceId);
  try {
    assertTrustedMutationOrigin(request);
    stage = "body_parse";
    const body = loginSchema.parse(await request.json());
    stage = "auth_service";
    const result = await login(body, context);
    const response = apiSuccess({ nextStep: result.nextStep }, context.requestId);
    stage = "cookie_write";
    setAuthCookies(response, result.rawToken, deviceId);
    writeLog("info", { requestId: context.requestId, module: "auth", route: "/api/v2/auth/login", result: "login_succeeded", durationMs: Date.now() - startedAt });
    return response;
  } catch (error) {
    const safe = safeErrorMetadata(error);
    const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 500;
    writeLog(status >= 400 && status < 500 ? "warn" : "error", {
      requestId: context.requestId, module: "auth", route: "/api/v2/auth/login",
      result: "login_failed", stage: safeErrorStage(error) ?? stage, durationMs: Date.now() - startedAt,
      errorCode: safe.errorCode, errorClass: safe.errorClass,
    });
    markSafeErrorLogged(error);
    return apiError(error, context.requestId);
  }
}
