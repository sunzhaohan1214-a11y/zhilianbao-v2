import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { foundationRequestContext } from "@/lib/api/foundation-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
export async function GET(request: NextRequest) { const context = buildAuthRequestContext(request); try { const { actor, batches } = await foundationRequestContext(request); return apiSuccess(await batches.publicList({ actor, context }), context.requestId); } catch (error) { return apiError(error, context.requestId); } }
