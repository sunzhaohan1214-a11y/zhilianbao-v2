const REDACTED = "[REDACTED]";
const SENSITIVE_KEY = /(?:password|passwordhash|token|session|secret|secretid|secretkey|authorization|cookie|phone|idcard|prompt|response|invoicebody)/i;
type StringReplacement = string | ((substring: string) => string);
const SENSITIVE_STRING_PATTERNS: ReadonlyArray<readonly [RegExp, StringReplacement]> = [
  [/\bauthorization\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi, `Authorization:${REDACTED}`],
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, `Bearer ${REDACTED}`],
  [/\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}\b/g, REDACTED],
  [/\bAKID[A-Za-z0-9]{16,}\b/g, REDACTED],
  [/\b(?:password|passwd|token|secret|session|cookie)\s*[:=]\s*[^\s,;]+/gi, (match) => `${match.slice(0, Math.max(match.indexOf(":"), match.indexOf("=")) + 1)}${REDACTED}`],
  [/(?:mysql|postgres(?:ql)?):\/\/[^\s/@:]+:[^\s/@]+@/gi, (match) => `${match.slice(0, match.indexOf("://") + 3)}${REDACTED}@`],
  [/\b1[3-9]\d{9}\b/g, REDACTED],
  [/\b\d{17}[0-9Xx]\b/g, REDACTED],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED],
];

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

function redactString(value: string): string {
  return SENSITIVE_STRING_PATTERNS.reduce((current, [pattern, replacement]) => typeof replacement === "string" ? current.replace(pattern, replacement) : current.replace(pattern, replacement), value);
}

export function redactLogValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return redactString(value);
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
