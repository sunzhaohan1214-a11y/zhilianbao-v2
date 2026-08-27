import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { tripRequestContext } from "@/lib/api/trip-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { id } = await params;
    const { actor, service } = await tripRequestContext(request);
    return apiSuccess(await service.get({ actor, tripId: id }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
