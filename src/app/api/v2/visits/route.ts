import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { tripRequestContext } from "@/lib/api/trip-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await tripRequestContext(request);
    return apiSuccess(await service.listVisits({
      actor,
      page: Number(request.nextUrl.searchParams.get("page") ?? 1),
      pageSize: Number(request.nextUrl.searchParams.get("pageSize") ?? 20),
    }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
