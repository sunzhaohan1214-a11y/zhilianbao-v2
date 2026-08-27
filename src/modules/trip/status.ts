export const TRIP_STATUSES = ["PLANNED", "IN_PROGRESS", "PENDING_RESULT", "COMPLETED", "CANCELED"] as const;
export type TripStatus = (typeof TRIP_STATUSES)[number];

export type TripStatusFacts = {
  canceledAt: Date | null;
  result?: unknown | null;
  nodes: readonly { plannedStartAt: Date; plannedEndAt?: Date | null }[];
  overallEndAt: Date | null;
};

const shanghaiDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function shanghaiDateKey(at: Date): string {
  return shanghaiDateFormatter.format(at);
}

export function shanghaiEndOfDay(at: Date): Date {
  return new Date(`${shanghaiDateKey(at)}T23:59:59.999+08:00`);
}

export function effectiveTripEnd(facts: TripStatusFacts): Date {
  if (facts.overallEndAt) return facts.overallEndAt;
  const latest = [...facts.nodes].sort((left, right) => right.plannedStartAt.getTime() - left.plannedStartAt.getTime())[0];
  if (!latest) throw new Error("TRIP_REQUIRES_NODE");
  return shanghaiEndOfDay(latest.plannedStartAt);
}

export function deriveTripStatus(facts: TripStatusFacts, now = new Date()): TripStatus {
  if (facts.canceledAt) return "CANCELED";
  if (facts.result) return "COMPLETED";
  const earliest = [...facts.nodes].sort((left, right) => left.plannedStartAt.getTime() - right.plannedStartAt.getTime())[0];
  if (!earliest) throw new Error("TRIP_REQUIRES_NODE");
  if (now < earliest.plannedStartAt) return "PLANNED";
  if (now <= effectiveTripEnd(facts)) return "IN_PROGRESS";
  return "PENDING_RESULT";
}

export const TRIP_STATUS_LABEL: Readonly<Record<TripStatus, string>> = {
  PLANNED: "待进行",
  IN_PROGRESS: "进行中",
  PENDING_RESULT: "待补充结果",
  COMPLETED: "已完成",
  CANCELED: "已取消",
};

export function formatShanghai(at: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(at);
}
