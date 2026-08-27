import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { enterpriseRequestContext } from "@/lib/api/enterprise-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { resubmitEnterpriseChangeRequestSchema } from "@/modules/enterprise/schemas";

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await enterpriseRequestContext(request, true);
    const body = resubmitEnterpriseChangeRequestSchema.parse(await request.json());
    const { id } = await route.params;
    return apiSuccess(await service.resubmitChangeRequest({ actor, context, requestId: id, body }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
