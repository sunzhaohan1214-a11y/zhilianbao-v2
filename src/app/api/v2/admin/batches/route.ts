import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { foundationRequestContext } from "@/lib/api/foundation-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
export async function GET(request: NextRequest) { const context = buildAuthRequestContext(request); try { const { actor, batches } = await foundationRequestContext(request); return apiSuccess(await batches.list({ actor, context }), context.requestId); } catch (error) { return apiError(error, context.requestId); } }
export async function POST(request: NextRequest) { const context = buildAuthRequestContext(request); try { const { actor, batches } = await foundationRequestContext(request, true); return apiSuccess(await batches.create({ actor, context, batch: await request.json() }), context.requestId, 201); } catch (error) { return apiError(error, context.requestId); } }
