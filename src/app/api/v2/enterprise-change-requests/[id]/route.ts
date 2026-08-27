import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { enterpriseRequestContext } from "@/lib/api/enterprise-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function GET(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await enterpriseRequestContext(request);
    const { id } = await route.params;
    return apiSuccess(await service.getChangeRequest({ actor, context, requestId: id }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
