import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { enterpriseRequestContext } from "@/lib/api/enterprise-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { createEnterpriseChangeRequestSchema, enterpriseChangeRequestListQuerySchema } from "@/modules/enterprise/schemas";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await enterpriseRequestContext(request);
    const query = enterpriseChangeRequestListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return apiSuccess(await service.listChangeRequests({ actor, context, query }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await enterpriseRequestContext(request, true);
    const body = createEnterpriseChangeRequestSchema.parse(await request.json());
    return apiSuccess(await service.createChangeRequest({ actor, context, request: body }), context.requestId, 201);
  } catch (error) { return apiError(error, context.requestId); }
}
