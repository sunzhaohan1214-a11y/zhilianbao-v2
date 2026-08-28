import { ReportingError, ReportingService } from "@/modules/reporting";
import { PermanentJobError, RetryableJobError } from "../errors";
import type { JobHandler } from "../handler-registry";

export class MonthlyReportExportJobHandler implements JobHandler<"MONTHLY_REPORT_EXPORT"> {
  constructor(private readonly service = new ReportingService()) {}
  async handle(payload: { exportTaskId: string }) {
    try {
      await this.service.processExport(payload.exportTaskId);
    } catch (error) {
      const code = error instanceof ReportingError ? error.code : error instanceof Error ? error.message : null;
      if (code && ["REPORT_PERMISSION_REVOKED", "REPORT_EXCEL_MONEY_PRECISION_UNSAFE", "REPORT_QUERY_SNAPSHOT_INVALID"].includes(code)) {
        throw new PermanentJobError(code, error instanceof Error ? error.message : code, { cause: error });
      }
      throw new RetryableJobError("MONTHLY_REPORT_EXPORT_TRANSIENT", "月度工作台账导出暂时失败", { cause: error });
    }
  }
}
