import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { clearSessionCookie } from "@/lib/auth/cookies";
import { requireRequestSession } from "@/lib/auth/current-session";
import { assertTrustedMutationOrigin } from "@/lib/auth/origin";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { revokeOwnSession } from "@/modules/identity/auth-service";
import { AuthError } from "@/modules/identity/errors";
import { canAccessBusiness } from "@/modules/identity/session-service";

export async function POST(request: NextRequest, contextParam: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    assertTrustedMutationOrigin(request);
    const current = await requireRequestSession(request);
    if (!canAccessBusiness(current)) throw new AuthError("RESTRICTED_SESSION", "请先完成账号激活或改密", 403);
    const { id } = await contextParam.params;
    const result = await revokeOwnSession(current, id);
    const response = apiSuccess(result, context.requestId);
    if (result.revokedCurrent) clearSessionCookie(response);
    return response;
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
