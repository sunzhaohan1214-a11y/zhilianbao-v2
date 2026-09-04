import { z } from "zod";
import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { importExportRequestContext } from "@/lib/api/import-export-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { resolveImportRowSchema } from "@/modules/import-export/schemas";

const requestSchema = z.object({
  batchId: z.string().uuid(),
  rowId: z.string().uuid(),
  resolution: resolveImportRowSchema,
});

export async function POST(request: NextRequest) {
  const context = buildAuthRequestContext(request);
  try {
    const body = requestSchema.parse(await request.json());
    const { actor, importService } = await importExportRequestContext(request, true);
    return apiSuccess(await importService.resolveRow({
      actor,
      context,
      batchId: body.batchId,
      rowId: body.rowId,
      body: body.resolution,
    }), context.requestId);
  } catch (error) {
    return apiError(error, context.requestId);
  }
}
