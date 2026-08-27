import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { policyRequestContext } from "@/lib/api/policy-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { createPolicyVersionSchema } from "@/modules/policy";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try { const { actor, service } = await policyRequestContext(request, true); return apiSuccess(await service.createVersion({ actor, context, policyId: (await params).id, version: createPolicyVersionSchema.parse(await request.json()) }), context.requestId, 201); }
  catch (error) { return apiError(error, context.requestId); }
}
