import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { formalDemandRequestContext } from "@/lib/api/formal-demand-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await formalDemandRequestContext(request, true);
    const { id } = await route.params;
    return apiSuccess(await service.claim({
      actor,
      context,
      demandId: id,
      body: await request.json(),
      idempotencyKey: request.headers.get("Idempotency-Key"),
    }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
