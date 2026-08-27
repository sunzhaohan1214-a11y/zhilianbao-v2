import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { foundationRequestContext } from "@/lib/api/foundation-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { collaborationCandidateQuerySchema } from "@/modules/member-foundation";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, members } = await foundationRequestContext(request);
    const query = collaborationCandidateQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return apiSuccess(await members.collaborationCandidates({ actor, context, query }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
