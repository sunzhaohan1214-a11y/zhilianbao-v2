import type { NextRequest } from "next/server";
import { helpRequestContext } from "@/lib/api/help-route";
import { apiError, apiSuccess } from "@/lib/api/response";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try { const { actor, service } = await helpRequestContext(request); return apiSuccess(await service.detail({ actor, context, helpRequestId: (await params).id }), context.requestId); }
  catch (error) { return apiError(error, context.requestId); }
}
