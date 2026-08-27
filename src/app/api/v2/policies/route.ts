import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { policyRequestContext } from "@/lib/api/policy-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { policyListQuerySchema } from "@/modules/policy";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await policyRequestContext(request);
    const query = policyListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return apiSuccess(await service.list({ actor, context, query }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
