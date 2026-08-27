import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { foundationRequestContext } from "@/lib/api/foundation-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { memberListQuerySchema } from "@/modules/member-foundation";
export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, members } = await foundationRequestContext(request);
    const query = memberListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams));
    return apiSuccess(await members.list({ actor, context, query }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
