import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { foundationRequestContext } from "@/lib/api/foundation-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
export async function GET(request: NextRequest, route: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try { const { actor, organizations } = await foundationRequestContext(request); return apiSuccess(await organizations.detail({ actor, context, organizationId: (await route.params).id }), context.requestId); }
  catch (error) { return apiError(error, context.requestId); }
}
