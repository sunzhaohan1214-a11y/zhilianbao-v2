import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { importExportRequestContext } from "@/lib/api/import-export-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) { const context = buildAuthRequestContext(request); try { const { id } = await params; const { actor, importService } = await importExportRequestContext(request); return apiSuccess(await importService.detail({ actor, context, batchId: id }), context.requestId); } catch (error) { return apiError(error, context.requestId); } }
