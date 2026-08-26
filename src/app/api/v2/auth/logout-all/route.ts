import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { clearSessionCookie } from "@/lib/auth/cookies";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { logoutAll } from "@/modules/identity/auth-service";

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    assertTrustedMutationOrigin(request);
    await logoutAll(await requireRequestSession(request), context);
    const response = apiSuccess({}, context.requestId);
    clearSessionCookie(response);
    return response;
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
