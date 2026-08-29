import type { NextRequest } from "next/server";
import { aiRequestContext } from "@/lib/api/ai-route";
import { apiError, apiSuccess } from "@/lib/api/response";

export async function POST(request: NextRequest) {
  let requestId: string | undefined;
  try {
    const { actor, context, chat } = await aiRequestContext(request);
    requestId = context.requestId;
    return apiSuccess(await chat.ask({ actor, body: await request.json() }), requestId);
  } catch (error) { return apiError(error, requestId); }
}
