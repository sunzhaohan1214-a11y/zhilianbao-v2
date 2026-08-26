import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { requireRequestSession } from "@/lib/auth/current-session";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { AuthError } from "@/modules/identity/errors";
import { canAccessBusiness } from "@/modules/identity/session-service";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const current = await requireRequestSession(request);
    if (!canAccessBusiness(current)) throw new AuthError("RESTRICTED_SESSION", "请先完成账号激活或改密", 403);
    return apiSuccess({
      personId: current.personId,
      accountId: current.accountId,
      name: current.name,
      phone: current.phone,
      accountStatus: current.accountStatus,
      requiresPasswordChange: current.forcePasswordChange,
      requiresActivation: current.accountStatus === "UNACTIVATED",
      roles: current.roles,
    }, context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
