import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireRequestSession } from "@/lib/auth/current-session";
import { setAuthCookies } from "@/lib/auth/cookies";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { changePassword } from "@/modules/identity/auth-service";
import { changePasswordSchema } from "@/modules/identity/schemas";

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    assertTrustedMutationOrigin(request);
    const current = await requireRequestSession(request);
    const body = changePasswordSchema.parse(await request.json());
    const result = await changePassword({ current, ...body, context });
    const response = apiSuccess({ nextStep: "HOME" }, context.requestId);
    setAuthCookies(response, result.rawToken, context.deviceId);
    return response;
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
