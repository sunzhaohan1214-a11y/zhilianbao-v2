import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { setAuthCookies } from "@/lib/auth/cookies";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext, getDeviceId } from "@/lib/auth/request-context";
import { login } from "@/modules/identity/auth-service";
import { loginSchema } from "@/modules/identity/schemas";

export async function POST(request: NextRequest) {
  const deviceId = getDeviceId(request);
  const context = buildAuthRequestContext(request, deviceId);
  try {
    assertTrustedMutationOrigin(request);
    const body = loginSchema.parse(await request.json());
    const result = await login(body, context);
    const response = apiSuccess({ nextStep: result.nextStep }, context.requestId);
    setAuthCookies(response, result.rawToken, deviceId);
    return response;
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
