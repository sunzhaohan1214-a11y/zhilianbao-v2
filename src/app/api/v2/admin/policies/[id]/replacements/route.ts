import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { policyRequestContext } from "@/lib/api/policy-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { replacementCreateSchema } from "@/modules/policy";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try { const { actor, service } = await policyRequestContext(request, true); const body = replacementCreateSchema.parse(await request.json()); return apiSuccess(await service.createReplacement({ actor, context, newPolicyId: (await params).id, ...body }), context.requestId, 201); }
  catch (error) { return apiError(error, context.requestId); }
}
