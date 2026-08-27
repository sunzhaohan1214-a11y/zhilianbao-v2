import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { foundationRequestContext } from "@/lib/api/foundation-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) { const context = buildAuthRequestContext(request); try { const { actor, batches } = await foundationRequestContext(request, true); return apiSuccess(await batches.setGroupLeader({ actor, context, batchId: (await route.params).id, command: await request.json() }), context.requestId); } catch (error) { return apiError(error, context.requestId); } }
