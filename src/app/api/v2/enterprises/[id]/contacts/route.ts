import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { enterpriseRequestContext } from "@/lib/api/enterprise-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { enterpriseContactCreateSchema } from "@/modules/enterprise/schemas";

export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await enterpriseRequestContext(request, true);
    const contact = enterpriseContactCreateSchema.parse(await request.json());
    const { id } = await route.params;
    return apiSuccess(await service.createContact({ actor, context, enterpriseId: id, contact }), context.requestId, 201);
  } catch (error) { return apiError(error, context.requestId); }
}
