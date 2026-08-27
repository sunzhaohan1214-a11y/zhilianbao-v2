import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { presenceRequestContext } from "@/lib/api/presence-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await presenceRequestContext(request);
    return apiSuccess(await service.adminHistory({
      actor,
      context,
      query: Object.fromEntries(request.nextUrl.searchParams),
    }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
