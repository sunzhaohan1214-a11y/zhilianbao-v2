import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { demandLeadRequestContext } from "@/lib/api/demand-lead-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { closeDemandLeadSchema } from "@/modules/demand/schemas";

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await demandLeadRequestContext(request, true);
    const body = closeDemandLeadSchema.parse(await request.json());
    const { id } = await route.params;
    return apiSuccess(await service.close({ actor, context, leadId: id, ...body }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
