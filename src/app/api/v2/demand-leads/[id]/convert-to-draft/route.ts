import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { demandLeadRequestContext } from "@/lib/api/demand-lead-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { convertDemandLeadSchema } from "@/modules/demand/schemas";

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await demandLeadRequestContext(request, true);
    const conversion = convertDemandLeadSchema.parse(await request.json());
    const { id } = await route.params;
    return apiSuccess(await service.convertToDraft({ actor, context, leadId: id, conversion }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
