import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { reportingRequestContext } from "@/lib/api/reporting-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await reportingRequestContext(request, true);
    return apiSuccess(await service.createMonthlyExport({ actor, body: await request.json(), idempotencyKey: request.headers.get("idempotency-key") ?? undefined, context }), context.requestId, 202);
  } catch (error) { return apiError(error, context.requestId); }
}
