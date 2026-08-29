const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(?:password|passwordhash|token|session|secret|secretid|secretkey|authorization|cookie|phone|idcard|prompt|response|invoicebody)/i;

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogEntry = {
  requestId?: string;
  module: string;
  route?: string;
  durationMs?: number;
  result: string;
  errorCode?: string;
  [key: string]: unknown;
};

export function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, seen));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    SENSITIVE_KEY.test(key) ? REDACTED : redactLogValue(item, seen),
  ]));
}

export function writeLog(level: LogLevel, entry: LogEntry): void {
  const payload = redactLogValue({
    ...entry,
    timestamp: new Date().toISOString(),
    level,
    requestId: entry.requestId,
    module: entry.module,
    route: entry.route,
    durationMs: entry.durationMs,
    result: entry.result,
    errorCode: entry.errorCode,
  });
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
