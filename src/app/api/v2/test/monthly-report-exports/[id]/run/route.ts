import type { NextRequest } from "next/server";
import { apiError, apiSuccess } from "@/lib/api/response";
import { reportingRequestContext } from "@/lib/api/reporting-route";
import { buildAuthRequestContext } from "@/lib/auth/request-context";
import { ReportingError } from "@/modules/reporting/errors";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const context = buildAuthRequestContext(request);
  try {
    if (process.env.APP_ENV !== "test") throw new ReportingError("REPORT_NOT_FOUND", "测试接口不存在");
    const { actor, service } = await reportingRequestContext(request, true);
    const id = (await params).id;
    await service.exportDetail({ actor, taskId: id });
    await service.processExport(id);
    return apiSuccess({ processed: true }, context.requestId);
  } catch (error) { return apiError(error, context.requestId); }
}
