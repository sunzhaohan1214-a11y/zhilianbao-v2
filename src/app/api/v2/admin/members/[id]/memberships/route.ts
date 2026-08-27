import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { foundationRequestContext } from "@/lib/api/foundation-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
export async function POST(request: NextRequest, route: { params: Promise<{ id: string }> }) { const context = buildAuthRequestContext(request); try { const { actor, batches } = await foundationRequestContext(request, true); return apiSuccess(await batches.addMembership({ actor, context, personId: (await route.params).id, membership: await request.json() }), context.requestId, 201); } catch (error) { return apiError(error, context.requestId); } }
