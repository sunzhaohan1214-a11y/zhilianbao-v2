export type HelpErrorCode =
  | "HELP_NOT_FOUND"
  | "HELP_FORBIDDEN"
  | "HELP_STATE_CONFLICT"
  | "HELP_ALREADY_CLAIMED"
  | "HELP_PERSON_INVALID"
  | "HELP_ORGANIZATION_INVALID"
  | "HELP_ORGANIZATION_MEMBERSHIP_REQUIRED"
  | "HELP_EXPECTED_DATE_INVALID"
  | "HELP_ATTACHMENT_INVALID"
  | "HELP_IDEMPOTENCY_REQUIRED"
  | "HELP_IDEMPOTENCY_CONFLICT";

const STATUS: Record<HelpErrorCode, number> = {
  HELP_NOT_FOUND: 404,
  HELP_FORBIDDEN: 403,
  HELP_STATE_CONFLICT: 409,
  HELP_ALREADY_CLAIMED: 409,
  HELP_PERSON_INVALID: 422,
  HELP_ORGANIZATION_INVALID: 422,
  HELP_ORGANIZATION_MEMBERSHIP_REQUIRED: 403,
  HELP_EXPECTED_DATE_INVALID: 422,
  HELP_ATTACHMENT_INVALID: 422,
  HELP_IDEMPOTENCY_REQUIRED: 400,
  HELP_IDEMPOTENCY_CONFLICT: 409,
};

export class HelpError extends Error {
  readonly status: number;

  constructor(
    public readonly code: HelpErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HelpError";
    this.status = STATUS[code];
  }
}

export const isHelpError = (error: unknown): error is HelpError =>
  error instanceof HelpError;
