const DAY_MS = 24 * 60 * 60_000;

function shanghaiDateKey(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function futureShanghaiPresenceInterval(reference = new Date(), daysAhead = 7) {
  if (!Number.isInteger(daysAhead) || daysAhead < 1) {
    throw new Error("Presence E2E interval must be at least one Shanghai business day ahead");
  }
  const date = shanghaiDateKey(new Date(reference.getTime() + daysAhead * DAY_MS));
  return {
    arrivalAtLocal: `${date}T09:00`,
    expectedDepartureAtLocal: `${date}T18:00`,
    arrivalAtIso: `${date}T09:00:00+08:00`,
    expectedDepartureAtIso: `${date}T18:00:00+08:00`,
  };
}
