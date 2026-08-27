import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { tripRequestContext } from "@/lib/api/trip-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await tripRequestContext(request);
    return apiSuccess(await service.listToday({ actor }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
