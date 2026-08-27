import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { presenceRequestContext } from "@/lib/api/presence-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { id } = await params;
    const { actor, service } = await presenceRequestContext(request, true);
    return apiSuccess(await service.cancelMine({ actor, context, reportId: id, body: await request.json() }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
