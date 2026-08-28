export const IMPORT_EXPORT_ERROR_CODES = [
  "IMPORT_NOT_FOUND", "IMPORT_FORBIDDEN", "IMPORT_STATE_CONFLICT", "IMPORT_FILE_INVALID",
  "IMPORT_MAPPING_INVALID", "IMPORT_PREVIEW_STALE", "IMPORT_BLOCKING_ROWS", "IMPORT_IDEMPOTENCY_CONFLICT",
  "IMPORT_ROW_RESOLUTION_INVALID", "IMPORT_IDENTITY_CONFLICT", "IMPORT_DISABLED_ENTERPRISE_REQUIRES_GOVERNANCE",
  "IMPORT_BATCH_TOO_LARGE", "EXPORT_FORBIDDEN", "EXPORT_TOO_LARGE",
  "EXPORT_FILTER_INVALID",
] as const;

export type ImportExportErrorCode = (typeof IMPORT_EXPORT_ERROR_CODES)[number];

const STATUS: Record<ImportExportErrorCode, number> = {
  IMPORT_NOT_FOUND: 404,
  IMPORT_FORBIDDEN: 403,
  IMPORT_STATE_CONFLICT: 409,
  IMPORT_FILE_INVALID: 422,
  IMPORT_MAPPING_INVALID: 422,
  IMPORT_PREVIEW_STALE: 409,
  IMPORT_BLOCKING_ROWS: 409,
  IMPORT_IDEMPOTENCY_CONFLICT: 409,
  IMPORT_ROW_RESOLUTION_INVALID: 422,
  IMPORT_IDENTITY_CONFLICT: 409,
  IMPORT_DISABLED_ENTERPRISE_REQUIRES_GOVERNANCE: 409,
  IMPORT_BATCH_TOO_LARGE: 422,
  EXPORT_FORBIDDEN: 403,
  EXPORT_TOO_LARGE: 422,
  EXPORT_FILTER_INVALID: 422,
};

export class ImportExportError extends Error {
  readonly status: number;
  constructor(readonly code: ImportExportErrorCode, message: string, readonly details?: Record<string, unknown>) {
    super(message);
    this.name = "ImportExportError";
    this.status = STATUS[code];
  }
}

export function isImportExportError(error: unknown): error is ImportExportError {
  return error instanceof ImportExportError;
}
