import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { foundationRequestContext } from "@/lib/api/foundation-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
export async function POST(request: NextRequest) { const context = buildAuthRequestContext(request); try { const { actor, organizations } = await foundationRequestContext(request, true); return apiSuccess(await organizations.createAppointment({ actor, context, appointment: await request.json() }), context.requestId, 201); } catch (error) { return apiError(error, context.requestId); } }
