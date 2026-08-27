export const PRESENCE_ERROR_CODES = [
  "PRESENCE_NOT_FOUND",
  "PRESENCE_INTERVAL_INVALID",
  "PRESENCE_INTERVAL_OVERLAP",
  "PRESENCE_SELF_EDIT_FORBIDDEN",
  "PRESENCE_CANCEL_REASON_REQUIRED",
] as const;

export type PresenceErrorCode = (typeof PRESENCE_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<PresenceErrorCode, number> = {
  PRESENCE_NOT_FOUND: 404,
  PRESENCE_INTERVAL_INVALID: 422,
  PRESENCE_INTERVAL_OVERLAP: 409,
  PRESENCE_SELF_EDIT_FORBIDDEN: 409,
  PRESENCE_CANCEL_REASON_REQUIRED: 422,
};

export class PresenceError extends Error {
  readonly status: number;

  constructor(
    public readonly code: PresenceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "PresenceError";
    this.status = STATUS_BY_CODE[code];
  }
}

export function isPresenceError(error: unknown): error is PresenceError {
  return error instanceof PresenceError;
}
