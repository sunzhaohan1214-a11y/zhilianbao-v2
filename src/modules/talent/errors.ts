export type TalentErrorCode =
  | "TALENT_NOT_FOUND"
  | "TALENT_FORBIDDEN"
  | "TALENT_STATE_CONFLICT"
  | "TALENT_VERSION_CONFLICT"
  | "TALENT_PERSON_INVALID"
  | "TALENT_REQUEST_NOT_FOUND"
  | "TALENT_REQUEST_STATE_CONFLICT"
  | "TALENT_ROUND_NOT_FOUND"
  | "TALENT_ROUND_CONFLICT"
  | "TALENT_AREA_INVALID"
  | "TALENT_ATTACHMENT_INVALID"
  | "TALENT_AI_UNAVAILABLE";

const STATUS: Record<TalentErrorCode, number> = {
  TALENT_NOT_FOUND: 404,
  TALENT_FORBIDDEN: 403,
  TALENT_STATE_CONFLICT: 409,
  TALENT_VERSION_CONFLICT: 409,
  TALENT_PERSON_INVALID: 422,
  TALENT_REQUEST_NOT_FOUND: 404,
  TALENT_REQUEST_STATE_CONFLICT: 409,
  TALENT_ROUND_NOT_FOUND: 404,
  TALENT_ROUND_CONFLICT: 409,
  TALENT_AREA_INVALID: 422,
  TALENT_ATTACHMENT_INVALID: 422,
  TALENT_AI_UNAVAILABLE: 503,
};
export class TalentError extends Error {
  readonly status: number;
  constructor(
    public readonly code: TalentErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "TalentError";
    this.status = STATUS[code];
  }
}
export const isTalentError = (error: unknown): error is TalentError =>
  error instanceof TalentError;
export const isPrismaUniqueConflict = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  error.code === "P2002";
