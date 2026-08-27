import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { presenceRequestContext } from "@/lib/api/presence-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await presenceRequestContext(request, true);
    return apiSuccess(await service.create({ actor, context, body: await request.json() }), context.requestId, 201);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
