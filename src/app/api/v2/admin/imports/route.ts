import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { importExportRequestContext } from "@/lib/api/import-export-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { importListQuerySchema } from "@/modules/import-export/schemas";

export async function GET(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try { const { actor, importService } = await importExportRequestContext(request); const query = importListQuerySchema.parse(Object.fromEntries(request.nextUrl.searchParams)); return apiSuccess(await importService.list({ actor, context, query }), context.requestId); }
  catch (error) { return apiError(error, context.requestId); }
}
export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try { const { actor, importService } = await importExportRequestContext(request, true); return apiSuccess(await importService.create({ actor, context, body: await request.json() }), context.requestId, 201); }
  catch (error) { return apiError(error, context.requestId); }
}
