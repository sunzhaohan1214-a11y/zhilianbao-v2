export const TRIP_ERROR_CODES = [
  "TRIP_NOT_FOUND",
  "TRIP_FORBIDDEN",
  "TRIP_STATE_CONFLICT",
  "TRIP_NODE_INVALID",
  "TRIP_DUPLICATE_ENTERPRISE",
  "TRIP_SIMILAR_FOUND",
  "TRIP_PARTICIPANT_INVALID",
  "TRIP_PARTICIPANT_ALREADY_ACTIVE",
  "TRIP_PARTICIPANT_NOT_ACTIVE",
  "TRIP_LAST_PARTICIPANT_CANNOT_LEAVE",
  "TRIP_ALUMNI_PRESENCE_REQUIRED",
  "TRIP_IDEMPOTENCY_REQUIRED",
  "TRIP_IDEMPOTENCY_CONFLICT",
  "TRIP_RESULT_ALREADY_EXISTS",
  "TRIP_ATTACHMENT_INVALID",
  "VISIT_NOT_FOUND",
  "VISIT_FORBIDDEN",
] as const;

export type TripErrorCode = (typeof TRIP_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<TripErrorCode, number> = {
  TRIP_NOT_FOUND: 404,
  TRIP_FORBIDDEN: 403,
  TRIP_STATE_CONFLICT: 409,
  TRIP_NODE_INVALID: 422,
  TRIP_DUPLICATE_ENTERPRISE: 422,
  TRIP_SIMILAR_FOUND: 409,
  TRIP_PARTICIPANT_INVALID: 422,
  TRIP_PARTICIPANT_ALREADY_ACTIVE: 409,
  TRIP_PARTICIPANT_NOT_ACTIVE: 409,
  TRIP_LAST_PARTICIPANT_CANNOT_LEAVE: 409,
  TRIP_ALUMNI_PRESENCE_REQUIRED: 422,
  TRIP_IDEMPOTENCY_REQUIRED: 400,
  TRIP_IDEMPOTENCY_CONFLICT: 409,
  TRIP_RESULT_ALREADY_EXISTS: 409,
  TRIP_ATTACHMENT_INVALID: 422,
  VISIT_NOT_FOUND: 404,
  VISIT_FORBIDDEN: 403,
};

export class TripError extends Error {
  readonly status: number;

  constructor(
    public readonly code: TripErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TripError";
    this.status = STATUS_BY_CODE[code];
  }
}

export function isTripError(error: unknown): error is TripError {
  return error instanceof TripError;
}

export function isUniqueConflict(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && (error as { code?: string }).code === "P2002",
  );
}
