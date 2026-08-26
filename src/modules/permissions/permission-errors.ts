export const PERMISSION_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN_CAPABILITY",
  "FORBIDDEN_SCOPE",
  "FORBIDDEN_RELATION",
  "FORBIDDEN_STATE",
  "FORBIDDEN_SENSITIVE_PERMISSION",
  "PERMISSION_CONFLICT",
  "PERMISSION_RULE_VIOLATION",
] as const;

export type PermissionErrorCode = (typeof PERMISSION_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<PermissionErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN_CAPABILITY: 403,
  FORBIDDEN_SCOPE: 403,
  FORBIDDEN_RELATION: 403,
  FORBIDDEN_STATE: 409,
  FORBIDDEN_SENSITIVE_PERMISSION: 403,
  PERMISSION_CONFLICT: 409,
  PERMISSION_RULE_VIOLATION: 422,
};

export class PermissionError extends Error {
  readonly status: number;

  constructor(
    public readonly code: PermissionErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PermissionError";
    this.status = STATUS_BY_CODE[code];
  }
}
export function isPermissionError(error: unknown): error is PermissionError {
  return error instanceof PermissionError;
}
