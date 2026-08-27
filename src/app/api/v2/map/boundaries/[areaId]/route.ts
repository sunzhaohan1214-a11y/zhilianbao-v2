import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { mapRequestContext } from "@/lib/api/map-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";

export async function GET(request: NextRequest, { params }: { params: Promise<{ areaId: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    const { actor, maps } = await mapRequestContext(request);
    return apiSuccess(await maps.listBoundaries({
      actor,
      context,
      areaId: (await params).areaId,
      includeHistory: request.nextUrl.searchParams.get("history") === "1",
    }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
