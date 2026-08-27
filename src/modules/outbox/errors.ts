export class PermanentOutboxError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PermanentOutboxError";
  }
}

export function safeOutboxError(error: unknown): string {
  return error instanceof PermanentOutboxError ? error.code.slice(0, 500) : "OUTBOX_HANDLER_ERROR";
}
