export class RetryableJobError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RetryableJobError";
  }
}

export class PermanentJobError extends Error {
  constructor(public readonly code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PermanentJobError";
  }
}

export function safeJobError(error: unknown): { code: string; summary: string; retryable: boolean } {
  if (error instanceof RetryableJobError) {
    return { code: error.code.slice(0, 100), summary: error.code.slice(0, 500), retryable: true };
  }
  if (error instanceof PermanentJobError) {
    return { code: error.code.slice(0, 100), summary: error.code.slice(0, 500), retryable: false };
  }
  return { code: "UNEXPECTED_JOB_ERROR", summary: "UNEXPECTED_JOB_ERROR", retryable: true };
}
