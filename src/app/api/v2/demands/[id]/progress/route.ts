import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { formalDemandRequestContext } from "@/lib/api/formal-demand-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, lifecycle } = await formalDemandRequestContext(request);
    return apiSuccess(await lifecycle.overview({ actor, context, demandId: (await params).id }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, lifecycle } = await formalDemandRequestContext(request, true);
    return apiSuccess(await lifecycle.addProgress({ actor, context, demandId: (await params).id, body: await request.json(), idempotencyKey: request.headers.get("Idempotency-Key") }), context.requestId, 201);
  } catch (error) { return apiError(error, context.requestId); }
}
