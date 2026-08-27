import type { NextRequest } from "next/server";
import { helpRequestContext } from "@/lib/api/help-route";
import { apiError, apiSuccess } from "@/lib/api/response";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { createHelpRequestSchema, helpListQuerySchema } from "@/modules/help/schemas";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await helpRequestContext(request);
    const query = helpListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return apiSuccess(await service.list({ actor, context, query }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await helpRequestContext(request, true);
    const body = createHelpRequestSchema.parse(await request.json());
    return apiSuccess(await service.create({ actor, context, body }), context.requestId, 201);
  } catch (error) { return apiError(error, context.requestId); }
}
