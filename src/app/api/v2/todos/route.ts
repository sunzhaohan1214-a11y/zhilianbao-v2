import type { NextRequest } from "next/server";
import { notificationRequestContext } from "@/lib/api/notification-route";
import { apiError, apiSuccess } from "@/lib/api/response";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await notificationRequestContext(request);
    return apiSuccess(await service.listTodos({ actor, query: Object.fromEntries(request.nextUrl.searchParams) }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
