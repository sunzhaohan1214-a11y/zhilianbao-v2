export type AIErrorCode = "AI_PROVIDER_UNAVAILABLE" | "AI_PROVIDER_TIMEOUT" | "AI_OUTPUT_INVALID";

export class AIError extends Error {
  constructor(
    public readonly code: AIErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AIError";
  }
}

