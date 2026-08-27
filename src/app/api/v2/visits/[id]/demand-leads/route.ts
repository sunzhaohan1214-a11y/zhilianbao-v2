import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { tripRequestContext } from "@/lib/api/trip-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { id } = await params;
    const { actor, service } = await tripRequestContext(request, true);
    return apiSuccess(await service.createDemandLead({
      actor, context, visitId: id, body: await request.json(), idempotencyKey: request.headers.get("idempotency-key"),
    }), context.requestId, 201);
  } catch (error) { return apiError(error, context.requestId); }
}
