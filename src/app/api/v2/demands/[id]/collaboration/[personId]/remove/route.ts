import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { formalDemandRequestContext } from "@/lib/api/formal-demand-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function POST(request: NextRequest, route: { params: Promise<{ id: string; personId: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await formalDemandRequestContext(request, true);
    const { id, personId } = await route.params;
    return apiSuccess(await service.removeCollaborator({ actor, context, demandId: id, personId, body: await request.json() }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
