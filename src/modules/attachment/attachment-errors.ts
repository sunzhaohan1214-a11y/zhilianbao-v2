export const ATTACHMENT_ERROR_CODES = [
  "ATTACHMENT_INVALID_INPUT",
  "ATTACHMENT_FORBIDDEN",
  "ATTACHMENT_NOT_FOUND",
  "ATTACHMENT_STATE_CONFLICT",
  "ATTACHMENT_TOO_LARGE",
  "ATTACHMENT_TYPE_UNSUPPORTED",
  "ATTACHMENT_VALIDATION_FAILED",
  "ATTACHMENT_STORAGE_UNAVAILABLE",
  "ATTACHMENT_SCANNER_UNAVAILABLE",
] as const;

export type AttachmentErrorCode = (typeof ATTACHMENT_ERROR_CODES)[number];

const STATUS_BY_CODE: Record<AttachmentErrorCode, number> = {
  ATTACHMENT_INVALID_INPUT: 400,
  ATTACHMENT_FORBIDDEN: 403,
  ATTACHMENT_NOT_FOUND: 404,
  ATTACHMENT_STATE_CONFLICT: 409,
  ATTACHMENT_TOO_LARGE: 413,
  ATTACHMENT_TYPE_UNSUPPORTED: 415,
  ATTACHMENT_VALIDATION_FAILED: 422,
  ATTACHMENT_STORAGE_UNAVAILABLE: 503,
  ATTACHMENT_SCANNER_UNAVAILABLE: 503,
};

export class AttachmentError extends Error {
  readonly status: number;

  constructor(
    public readonly code: AttachmentErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AttachmentError";
    this.status = STATUS_BY_CODE[code];
  }
}

export function isAttachmentError(error: unknown): error is AttachmentError {
  return error instanceof AttachmentError;
}
