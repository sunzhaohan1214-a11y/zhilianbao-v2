import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { policyRequestContext } from "@/lib/api/policy-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try { const { actor, service } = await policyRequestContext(request); return apiSuccess(await service.detail({ actor, context, policyId: (await params).id }), context.requestId); }
  catch (error) { return apiError(error, context.requestId); }
}
