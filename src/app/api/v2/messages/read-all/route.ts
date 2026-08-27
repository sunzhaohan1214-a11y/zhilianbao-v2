import type { NextRequest } from "next/server";
import { notificationRequestContext } from "@/lib/api/notification-route";
import { apiError, apiSuccess } from "@/lib/api/response";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, service } = await notificationRequestContext(request, true);
    return apiSuccess(await service.readAll({ actor }), context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
