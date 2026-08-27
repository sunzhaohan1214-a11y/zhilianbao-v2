export type NotificationErrorCode = "MESSAGE_NOT_FOUND" | "TODO_NOT_FOUND";

export class NotificationError extends Error {
  readonly status = 404;
  constructor(public readonly code: NotificationErrorCode, message: string) {
    super(message);
    this.name = "NotificationError";
  }
}

export const isNotificationError = (error: unknown): error is NotificationError =>
  error instanceof NotificationError;
