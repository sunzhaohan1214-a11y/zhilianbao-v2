export const FOUNDATION_ERROR_CODES = [
  "MEMBER_NOT_FOUND",
  "MEMBER_STATE_CONFLICT",
  "MEMBERSHIP_DUPLICATE",
  "MEMBERSHIP_LIMIT_EXCEEDED",
  "MEMBERSHIP_ORGANIZATION_INVALID",
  "BATCH_NOT_FOUND",
  "BATCH_STATE_CONFLICT",
  "BATCH_CURRENT_CLOSE_FORBIDDEN",
  "BATCH_ACTIVATION_STALE",
  "GROUP_LEADER_INVALID",
  "ORGANIZATION_NOT_FOUND",
  "ORGANIZATION_RELATION_INVALID",
  "APPOINTMENT_NOT_FOUND",
] as const;

export type FoundationErrorCode = (typeof FOUNDATION_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<FoundationErrorCode, number> = {
  MEMBER_NOT_FOUND: 404,
  MEMBER_STATE_CONFLICT: 409,
  MEMBERSHIP_DUPLICATE: 409,
  MEMBERSHIP_LIMIT_EXCEEDED: 409,
  MEMBERSHIP_ORGANIZATION_INVALID: 422,
  BATCH_NOT_FOUND: 404,
  BATCH_STATE_CONFLICT: 409,
  BATCH_CURRENT_CLOSE_FORBIDDEN: 409,
  BATCH_ACTIVATION_STALE: 409,
  GROUP_LEADER_INVALID: 422,
  ORGANIZATION_NOT_FOUND: 404,
  ORGANIZATION_RELATION_INVALID: 422,
  APPOINTMENT_NOT_FOUND: 404,
};

export class FoundationError extends Error {
  readonly status: number;
  constructor(
    public readonly code: FoundationErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FoundationError";
    this.status = STATUS_BY_CODE[code];
  }
}
export function isFoundationError(error: unknown): error is FoundationError {
  return error instanceof FoundationError;
}
