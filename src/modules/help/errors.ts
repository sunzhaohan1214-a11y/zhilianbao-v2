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

const HELP_COMMAND_IDEMPOTENCY_UNIQUE = "help_claim_idempotency_key";

export function isHelpCommandIdempotencyUniqueConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") {
    return false;
  }
  const meta = "meta" in error && typeof error.meta === "object" && error.meta !== null
    ? error.meta as Record<string, unknown>
    : {};
  const values = [meta.target, meta.constraint]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string");
  if (values.some((value) => value === HELP_COMMAND_IDEMPOTENCY_UNIQUE)) return true;
  const normalized = values.map((value) => value.replace(/[^a-z0-9]/gi, "").toLowerCase());
  const combined = normalized.join("|");
  return combined.includes("actorpersonid")
    && combined.includes("actioncode")
    && combined.includes("idempotencykeyhash");
}
