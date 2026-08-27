import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { demandLeadRequestContext } from "@/lib/api/demand-lead-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { createOtherDemandLeadSchema, demandLeadListQuerySchema } from "@/modules/demand/schemas";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await demandLeadRequestContext(request);
    const query = demandLeadListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return apiSuccess(await service.list({ actor, context, query }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await demandLeadRequestContext(request, true);
    const lead = createOtherDemandLeadSchema.parse(await request.json());
    return apiSuccess(await service.createOther({ actor, context, lead }), context.requestId, 201);
  } catch (error) { return apiError(error, context.requestId); }
}
