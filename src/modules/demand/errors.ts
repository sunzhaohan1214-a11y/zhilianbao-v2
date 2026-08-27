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

export function isPrismaUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
