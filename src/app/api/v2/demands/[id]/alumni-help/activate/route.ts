import type { NextRequest } from "next/server";
import { demandRecommendationRequestContext } from "@/lib/api/demand-recommendation-route";
import { apiError, apiSuccess } from "@/lib/api/response";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await demandRecommendationRequestContext(request, true);
    const { id } = await route.params;
    return apiSuccess(await service.activateAlumniHelp({ actor, context, demandId: id, body: await request.json() }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
