const STATUS_BY_CODE: Record<string, number> = {
  REPORT_FORBIDDEN: 403,
  REPORT_NOT_FOUND: 404,
  REPORT_FILTER_FORBIDDEN: 403,
  REPORT_IDEMPOTENCY_REQUIRED: 400,
  REPORT_IDEMPOTENCY_CONFLICT: 409,
  REPORT_EXPORT_STATE_CONFLICT: 409,
  REPORT_PERMISSION_REVOKED: 403,
};

export class ReportingError extends Error {
  readonly status: number;
  constructor(readonly code: string, message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "ReportingError";
    this.status = STATUS_BY_CODE[code] ?? 400;
  }
}

export function isReportingError(error: unknown): error is ReportingError {
  return error instanceof ReportingError;
}
