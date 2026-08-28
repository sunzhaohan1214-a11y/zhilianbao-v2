import { ReportingError, ReportingService } from "@/modules/reporting";
import { PermanentJobError, RetryableJobError } from "../errors";
import type { JobHandler } from "../handler-registry";

export class MonthlyReportExportJobHandler implements JobHandler<"MONTHLY_REPORT_EXPORT"> {
  constructor(private readonly service = new ReportingService()) {}
  async handle(payload: { exportTaskId: string }) {
    try {
      await this.service.processExport(payload.exportTaskId);
    } catch (error) {
      if (error instanceof ReportingError && error.code === "REPORT_PERMISSION_REVOKED") {
        throw new PermanentJobError(error.code, error.message, { cause: error });
      }
      throw new RetryableJobError("MONTHLY_REPORT_EXPORT_TRANSIENT", "月度工作台账导出暂时失败", { cause: error });
    }
  }
}
