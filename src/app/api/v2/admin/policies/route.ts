import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { policyRequestContext } from "@/lib/api/policy-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { createPolicySchema } from "@/modules/policy";

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try { const { actor, service } = await policyRequestContext(request, true); return apiSuccess(await service.create({ actor, context, policy: createPolicySchema.parse(await request.json()) }), context.requestId, 201); }
  catch (error) { return apiError(error, context.requestId); }
}
