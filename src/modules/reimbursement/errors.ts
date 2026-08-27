export type ReimbursementErrorCode =
  | "REIMBURSEMENT_NOT_FOUND" | "REIMBURSEMENT_FORBIDDEN" | "REIMBURSEMENT_STATE_CONFLICT"
  | "REIMBURSEMENT_APPLICANT_INELIGIBLE" | "REIMBURSEMENT_TRIP_INVALID"
  | "REIMBURSEMENT_EXPENSE_INVALID" | "REIMBURSEMENT_INVOICE_INVALID"
  | "REIMBURSEMENT_DUPLICATE_INVOICE" | "REIMBURSEMENT_OCR_UNAVAILABLE"
  | "REIMBURSEMENT_IDEMPOTENCY_REQUIRED" | "REIMBURSEMENT_IDEMPOTENCY_CONFLICT"
  | "REIMBURSEMENT_CORRECTION_INVALID" | "REIMBURSEMENT_EXPORT_INVALID";

const STATUS: Record<ReimbursementErrorCode, number> = {
  REIMBURSEMENT_NOT_FOUND: 404, REIMBURSEMENT_FORBIDDEN: 403,
  REIMBURSEMENT_STATE_CONFLICT: 409, REIMBURSEMENT_APPLICANT_INELIGIBLE: 403,
  REIMBURSEMENT_TRIP_INVALID: 422, REIMBURSEMENT_EXPENSE_INVALID: 422,
  REIMBURSEMENT_INVOICE_INVALID: 422, REIMBURSEMENT_DUPLICATE_INVOICE: 409,
  REIMBURSEMENT_OCR_UNAVAILABLE: 503, REIMBURSEMENT_IDEMPOTENCY_REQUIRED: 400,
  REIMBURSEMENT_IDEMPOTENCY_CONFLICT: 409, REIMBURSEMENT_CORRECTION_INVALID: 422,
  REIMBURSEMENT_EXPORT_INVALID: 422,
};

export class ReimbursementError extends Error {
  readonly status: number;
  constructor(public readonly code: ReimbursementErrorCode, message: string, public readonly details?: Record<string, unknown>) {
    super(message); this.name = "ReimbursementError"; this.status = STATUS[code];
  }
}
export const isReimbursementError = (error: unknown): error is ReimbursementError => error instanceof ReimbursementError;

export function isSubmitIdempotencyUniqueConflict(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "P2002") return false;
  const meta = "meta" in error && typeof error.meta === "object" && error.meta ? error.meta as Record<string, unknown> : {};
  const values = [meta.target, meta.constraint].flatMap((v) => Array.isArray(v) ? v : [v]).filter((v): v is string => typeof v === "string");
  const joined = values.join("|").replace(/[^a-z0-9]/gi, "").toLowerCase();
  return values.includes("reimbursement_submit_idempotency_key")
    || (joined.includes("actorpersonid") && joined.includes("idempotencykeyhash"));
}
