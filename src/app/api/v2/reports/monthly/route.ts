import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { reportingRequestContext } from "@/lib/api/reporting-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await reportingRequestContext(request);
    return apiSuccess(await service.previewMonthlyReport({ actor, query: Object.fromEntries(request.nextUrl.searchParams) }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
