import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { foundationRequestContext } from "@/lib/api/foundation-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try { const { actor, organizations } = await foundationRequestContext(request); return apiSuccess(await organizations.list({ actor, context, keyword: request.nextUrl.searchParams.get("keyword")?.trim() || undefined }), context.requestId); }
  catch (error) { return apiError(error, context.requestId); }
}
