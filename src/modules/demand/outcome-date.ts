const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateOnly(value: string): Date {
  const match = DATE_ONLY.exec(value);
  if (!match) throw new Error("INVALID_DATE_ONLY");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== value) throw new Error("INVALID_DATE_ONLY");
  return date;
}

export function dateOnlyString(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function shanghaiDateString(value = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shanghaiStartOfDate(dateOnly: string): Date {
  parseDateOnly(dateOnly);
  return new Date(`${dateOnly}T00:00:00.000+08:00`);
}

export function dueScheduledAt(dateOnly: string, now = new Date()): Date {
  const start = shanghaiStartOfDate(dateOnly);
  return start <= now ? now : start;
}

export function isDateDue(dateOnly: string, now = new Date()): boolean {
  return dateOnly <= shanghaiDateString(now);
}
