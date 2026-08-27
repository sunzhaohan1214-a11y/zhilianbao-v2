export type AnnouncementErrorCode =
  | "ANNOUNCEMENT_NOT_FOUND"
  | "ANNOUNCEMENT_FORBIDDEN"
  | "ANNOUNCEMENT_STATE_CONFLICT"
  | "ANNOUNCEMENT_CONFIRM_NOT_REQUIRED"
  | "ANNOUNCEMENT_AUDIENCE_EMPTY"
  | "ANNOUNCEMENT_ATTACHMENT_INVALID";

const STATUS: Record<AnnouncementErrorCode, number> = {
  ANNOUNCEMENT_NOT_FOUND: 404,
  ANNOUNCEMENT_FORBIDDEN: 403,
  ANNOUNCEMENT_STATE_CONFLICT: 409,
  ANNOUNCEMENT_CONFIRM_NOT_REQUIRED: 422,
  ANNOUNCEMENT_AUDIENCE_EMPTY: 422,
  ANNOUNCEMENT_ATTACHMENT_INVALID: 422,
};

export class AnnouncementError extends Error {
  readonly status: number;
  constructor(public readonly code: AnnouncementErrorCode, message: string) {
    super(message);
    this.name = "AnnouncementError";
    this.status = STATUS[code];
  }
}

export const isAnnouncementError = (error: unknown): error is AnnouncementError =>
  error instanceof AnnouncementError;
