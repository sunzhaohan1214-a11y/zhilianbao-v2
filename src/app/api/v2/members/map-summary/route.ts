import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { mapRequestContext } from "@/lib/api/map-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, maps } = await mapRequestContext(request);
    return apiSuccess(await maps.memberMap({ actor, context, query: Object.fromEntries(request.nextUrl.searchParams) }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
