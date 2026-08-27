import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { enterpriseRequestContext } from "@/lib/api/enterprise-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { enterpriseCoreSchema, enterpriseListQuerySchema } from "@/modules/enterprise/schemas";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await enterpriseRequestContext(request);
    const query = enterpriseListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return apiSuccess(await service.list({ actor, context, query }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await enterpriseRequestContext(request, true);
    const enterprise = enterpriseCoreSchema.parse(await request.json());
    return apiSuccess(await service.createFormal({ actor, context, enterprise }), context.requestId, 201);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
