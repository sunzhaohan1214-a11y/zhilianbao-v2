import type { PresenceStatus } from "./schemas";

export const PRESENCE_STATUS_LABEL: Record<PresenceStatus, string> = {
  FUTURE: "未来安排",
  IN_BAO: "当前在宝",
  ENDED: "已结束",
  CANCELED: "已取消",
};

export function formatShanghai(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

export function toShanghaiDateTimeLocal(value: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
