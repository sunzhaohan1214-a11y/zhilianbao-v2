import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { mapRequestContext } from "@/lib/api/map-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { enterpriseMapPointsQuerySchema } from "@/modules/map/schemas";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, maps } = await mapRequestContext(request);
    const query = enterpriseMapPointsQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return apiSuccess(await maps.enterpriseAreaDetail({ actor, context, ...query }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
