import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { foundationRequestContext } from "@/lib/api/foundation-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
export async function POST(request: NextRequest) { const context = buildAuthRequestContext(request); try { const { actor, members } = await foundationRequestContext(request, true); return apiSuccess(await members.updateCapabilityProfile({ actor, context, personId: actor.personId, profile: await request.json() }), context.requestId); } catch (error) { return apiError(error, context.requestId); } }
