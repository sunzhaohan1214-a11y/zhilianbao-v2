const SAFE_SYSTEM_CODES = new Set([
  "ECONNREFUSED", "ETIMEDOUT", "ECONNRESET", "ER_ACCESS_DENIED_ERROR",
  "ER_LOCK_WAIT_TIMEOUT", "ER_LOCK_DEADLOCK", "ER_CON_COUNT_ERROR",
]);

export type SafeErrorMetadata = {
  errorCode: string;
  errorClass: "prisma" | "database" | "application" | "unknown";
};

const safeStages = new WeakMap<object, string>();
const safelyLogged = new WeakSet<object>();

export function annotateSafeErrorStage(error: unknown, stage: string): void {
  if (typeof error === "object" && error !== null) safeStages.set(error, stage);
}

export function safeErrorStage(error: unknown): string | undefined {
  return typeof error === "object" && error !== null ? safeStages.get(error) : undefined;
}

export function markSafeErrorLogged(error: unknown): void {
  if (typeof error === "object" && error !== null) safelyLogged.add(error);
}

export function safeErrorWasLogged(error: unknown): boolean {
  return typeof error === "object" && error !== null && safelyLogged.has(error);
}

function classifyCode(code: unknown): SafeErrorMetadata | undefined {
  if (typeof code !== "string") return undefined;
  if (/^P\d{4}$/.test(code)) return { errorCode: code, errorClass: "prisma" };
  if (SAFE_SYSTEM_CODES.has(code)) return { errorCode: code, errorClass: "database" };
  if (/^[A-Z][A-Z0-9_]{2,63}$/.test(code)) return { errorCode: code, errorClass: "application" };
  return undefined;
}

export function safeErrorMetadata(error: unknown): SafeErrorMetadata {
  const seen = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 6 && current !== null && current !== undefined && !seen.has(current); depth += 1) {
    seen.add(current);
    if (typeof current === "object") {
      const candidate = current as { code?: unknown; cause?: unknown };
      const classified = classifyCode(candidate.code);
      if (classified) return classified;
      current = candidate.cause;
      continue;
    }
    break;
  }
  return { errorCode: "UNKNOWN_ERROR", errorClass: "unknown" };
}
