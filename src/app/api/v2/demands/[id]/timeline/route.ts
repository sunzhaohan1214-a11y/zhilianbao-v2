import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { formalDemandRequestContext } from "@/lib/api/formal-demand-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function GET(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await formalDemandRequestContext(request);
    const { id } = await route.params;
    return apiSuccess(await service.timeline({ actor, context, demandId: id }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
