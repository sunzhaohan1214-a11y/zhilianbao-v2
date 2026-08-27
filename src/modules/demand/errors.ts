export const DEMAND_LEAD_ERROR_CODES = [
  "DEMAND_LEAD_NOT_FOUND",
  "DEMAND_LEAD_STATE_CONFLICT",
  "DEMAND_LEAD_AREA_INVALID",
  "DEMAND_LEAD_ENTERPRISE_INVALID",
  "DEMAND_LEAD_CONTACT_INVALID",
  "DEMAND_LEAD_CURRENT_BATCH_INVALID",
  "DEMAND_LEAD_ATTACHMENT_INVALID",
  "DEMAND_LEAD_IDEMPOTENCY_REQUIRED",
  "DEMAND_LEAD_IDEMPOTENCY_CONFLICT",
  "DEMAND_LEAD_RATE_LIMITED",
  "DEMAND_LEAD_BEHAVIOR_REJECTED",
] as const;

export type DemandLeadErrorCode = (typeof DEMAND_LEAD_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<DemandLeadErrorCode, number> = {
  DEMAND_LEAD_NOT_FOUND: 404,
  DEMAND_LEAD_STATE_CONFLICT: 409,
  DEMAND_LEAD_AREA_INVALID: 422,
  DEMAND_LEAD_ENTERPRISE_INVALID: 422,
  DEMAND_LEAD_CONTACT_INVALID: 422,
  DEMAND_LEAD_CURRENT_BATCH_INVALID: 422,
  DEMAND_LEAD_ATTACHMENT_INVALID: 422,
  DEMAND_LEAD_IDEMPOTENCY_REQUIRED: 400,
  DEMAND_LEAD_IDEMPOTENCY_CONFLICT: 409,
  DEMAND_LEAD_RATE_LIMITED: 429,
  DEMAND_LEAD_BEHAVIOR_REJECTED: 422,
};

export class DemandLeadError extends Error {
  readonly status: number;

  constructor(
    public readonly code: DemandLeadErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DemandLeadError";
    this.status = STATUS_BY_CODE[code];
  }
}

export function isDemandLeadError(error: unknown): error is DemandLeadError {
  return error instanceof DemandLeadError;
}

export const DEMAND_ERROR_CODES = [
  "DEMAND_NOT_FOUND",
  "DEMAND_STATE_CONFLICT",
  "DEMAND_AREA_INVALID",
  "DEMAND_ENTERPRISE_INVALID",
  "DEMAND_CONTACT_INVALID",
  "DEMAND_CURRENT_BATCH_INVALID",
  "DEMAND_ATTACHMENT_INVALID",
  "DEMAND_ATTACHMENT_NOT_PASSED",
  "DEMAND_PROVENANCE_INVALID",
  "DEMAND_IDEMPOTENCY_REQUIRED",
  "DEMAND_IDEMPOTENCY_CONFLICT",
] as const;

export type DemandErrorCode = (typeof DEMAND_ERROR_CODES)[number];

const DEMAND_STATUS_BY_CODE: Record<DemandErrorCode, number> = {
  DEMAND_NOT_FOUND: 404,
  DEMAND_STATE_CONFLICT: 409,
  DEMAND_AREA_INVALID: 422,
  DEMAND_ENTERPRISE_INVALID: 422,
  DEMAND_CONTACT_INVALID: 422,
  DEMAND_CURRENT_BATCH_INVALID: 422,
  DEMAND_ATTACHMENT_INVALID: 422,
  DEMAND_ATTACHMENT_NOT_PASSED: 422,
  DEMAND_PROVENANCE_INVALID: 422,
  DEMAND_IDEMPOTENCY_REQUIRED: 400,
  DEMAND_IDEMPOTENCY_CONFLICT: 409,
};

export class DemandError extends Error {
  readonly status: number;

  constructor(
    public readonly code: DemandErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DemandError";
    this.status = DEMAND_STATUS_BY_CODE[code];
  }
}

export function isDemandError(error: unknown): error is DemandError {
  return error instanceof DemandError;
}

export function isPrismaUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

const DEMAND_COMMAND_IDEMPOTENCY_UNIQUE =
  "demand_command_idempotency_actor_person_id_action_key_hash_key";

export function isDemandCommandIdempotencyUniqueConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") {
    return false;
  }
  const meta = "meta" in error && typeof error.meta === "object" && error.meta !== null
    ? error.meta as Record<string, unknown>
    : {};
  const target = meta.target;
  const constraint = meta.constraint;
  const values = [target, constraint]
    .flatMap((value) => Array.isArray(value) ? value : [value])
    .filter((value): value is string => typeof value === "string");
  if (values.some((value) => value === DEMAND_COMMAND_IDEMPOTENCY_UNIQUE)) return true;
  const normalized = values.map((value) => value.replace(/[^a-z0-9]/gi, "").toLowerCase());
  const combined = normalized.join("|");
  return combined.includes("actorpersonid")
    && combined.includes("action")
    && combined.includes("keyhash");
}
