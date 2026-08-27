export const ENTERPRISE_ERROR_CODES = [
  "ENTERPRISE_NOT_FOUND",
  "ENTERPRISE_STATE_CONFLICT",
  "ENTERPRISE_FORBIDDEN",
  "ENTERPRISE_DUPLICATE_CREDIT_CODE",
  "ENTERPRISE_VERSION_CONFLICT",
  "ENTERPRISE_AREA_INVALID",
  "ENTERPRISE_CONTACT_NOT_FOUND",
  "ENTERPRISE_CONTACT_INVALID_REPLACEMENT",
  "ENTERPRISE_PRIMARY_CONTACT_REQUIRED",
  "ENTERPRISE_CHANGE_REQUEST_NOT_FOUND",
  "ENTERPRISE_CHANGE_REQUEST_STATE_CONFLICT",
] as const;

export type EnterpriseErrorCode = (typeof ENTERPRISE_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<EnterpriseErrorCode, number> = {
  ENTERPRISE_NOT_FOUND: 404,
  ENTERPRISE_STATE_CONFLICT: 409,
  ENTERPRISE_FORBIDDEN: 403,
  ENTERPRISE_DUPLICATE_CREDIT_CODE: 409,
  ENTERPRISE_VERSION_CONFLICT: 409,
  ENTERPRISE_AREA_INVALID: 422,
  ENTERPRISE_CONTACT_NOT_FOUND: 404,
  ENTERPRISE_CONTACT_INVALID_REPLACEMENT: 422,
  ENTERPRISE_PRIMARY_CONTACT_REQUIRED: 422,
  ENTERPRISE_CHANGE_REQUEST_NOT_FOUND: 404,
  ENTERPRISE_CHANGE_REQUEST_STATE_CONFLICT: 409,
};

export class EnterpriseError extends Error {
  readonly status: number;

  constructor(
    public readonly code: EnterpriseErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "EnterpriseError";
    this.status = STATUS_BY_CODE[code];
  }
}

export function isEnterpriseError(error: unknown): error is EnterpriseError {
  return error instanceof EnterpriseError;
}

export function isPrismaUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
