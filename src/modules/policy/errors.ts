export class PolicyError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "PolicyError";
  }
}

export function isPolicyError(error: unknown): error is PolicyError {
  return error instanceof PolicyError;
}
