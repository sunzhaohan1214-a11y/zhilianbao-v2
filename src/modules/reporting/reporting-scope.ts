import type { PermissionActor } from "@/modules/permissions/types";
import { ReportingError } from "./errors";

export type MonthlyReportScope = { countyWide: true; areaIds: [] } | { countyWide: false; areaIds: string[] };
const COUNTY_ROLES = new Set(["ADMIN", "SUPER_ADMIN", "GROUP_LEADER", "MINISTER"]);

export function canViewMonthlyReport(actor: PermissionActor): boolean {
  return actor.capabilities.has("report.view") || actor.capabilities.has("report.monthly.team_view");
}

export function canDownloadMonthlyReport(actor: PermissionActor): boolean {
  return actor.capabilities.has("report.monthly.download") || actor.capabilities.has("report.monthly.team_download");
}

export function resolveMonthlyReportScope(actor: PermissionActor): MonthlyReportScope {
  if (!canViewMonthlyReport(actor)) throw new ReportingError("REPORT_FORBIDDEN", "当前账号不能查看月度工作台账");
  if (actor.effectiveRoles.some((role) => COUNTY_ROLES.has(role))) return { countyWide: true, areaIds: [] };
  const areaIds = [...new Set([
    ...(actor.effectiveRoles.includes("TOWNSHIP_STAFF") ? actor.townshipAreaIds : []),
    ...(actor.effectiveRoles.includes("DEPARTMENT_STAFF") ? actor.departmentAreaIds : []),
  ])].sort();
  if (areaIds.length === 0) throw new ReportingError("REPORT_FORBIDDEN", "当前账号没有可用的月报数据范围");
  return { countyWide: false, areaIds };
}

export function resolveSelectedAreaIds(scope: MonthlyReportScope, selectedAreaId?: string): string[] | null {
  if (scope.countyWide) return selectedAreaId ? [selectedAreaId] : null;
  if (selectedAreaId && !scope.areaIds.includes(selectedAreaId)) {
    throw new ReportingError("REPORT_FILTER_FORBIDDEN", "筛选区域超出当前有效数据范围");
  }
  return selectedAreaId ? [selectedAreaId] : scope.areaIds;
}

export function scopeStillAllowed(snapshot: MonthlyReportScope, current: MonthlyReportScope): boolean {
  if (snapshot.countyWide) return current.countyWide;
  return current.countyWide || snapshot.areaIds.every((areaId) => current.areaIds.includes(areaId));
}
