import { ReportingError } from "./errors";

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export type MonthlyPeriod = {
  month: string;
  monthStart: Date;
  monthEndExclusive: Date;
  asOf: Date;
  asOfDate: string;
  current: boolean;
};

function nextMonth(month: string): string {
  const match = MONTH.exec(month)!;
  const year = Number(match[1]);
  const number = Number(match[2]);
  return `${number === 12 ? year + 1 : year}-${String(number === 12 ? 1 : number + 1).padStart(2, "0")}`;
}

export function shanghaiDateKey(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function resolveMonthlyPeriod(month: string, now = new Date()): MonthlyPeriod {
  if (!MONTH.test(month)) throw new ReportingError("REPORT_MONTH_INVALID", "月份必须使用 YYYY-MM");
  const monthStart = new Date(`${month}-01T00:00:00.000+08:00`);
  const monthEndExclusive = new Date(`${nextMonth(month)}-01T00:00:00.000+08:00`);
  if (monthStart > now) throw new ReportingError("REPORT_MONTH_IN_FUTURE", "不能生成未来月份的工作台账");
  const current = now < monthEndExclusive;
  const asOf = current ? new Date(now) : new Date(monthEndExclusive.getTime() - 1);
  return { month, monthStart, monthEndExclusive, asOf, asOfDate: shanghaiDateKey(asOf), current };
}

export function inPeriod(value: Date | null | undefined, period: Pick<MonthlyPeriod, "monthStart" | "monthEndExclusive">): boolean {
  return Boolean(value && value >= period.monthStart && value < period.monthEndExclusive);
}
