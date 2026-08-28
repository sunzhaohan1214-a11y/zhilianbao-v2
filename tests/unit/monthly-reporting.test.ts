import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import { getDemandProgressFreshnessAt, outcomePlanAt, resolveDemandBatchAt, statusAt } from "@/modules/reporting/demand-as-of";
import { ReportingError } from "@/modules/reporting/errors";
import { resolveMonthlyPeriod } from "@/modules/reporting/monthly-period";
import { buildMonthlyWorkbook, decimalStringToSafeExcelNumber, MONTHLY_REPORT_SHEETS, type MonthlyReportData } from "@/modules/reporting/monthly-workbook";
import { canDownloadMonthlyReport, resolveMonthlyReportScope, resolveSelectedAreaIds } from "@/modules/reporting/reporting-scope";
import { getTripBusinessDate, type ReportingService } from "@/modules/reporting/reporting-service";
import { MonthlyReportExportJobHandler } from "@/modules/jobs/handlers/monthly-report-export-handler";

function actor(roles: PermissionActor["effectiveRoles"]): PermissionActor {
  return { personId: "p", accountId: "a", accountStatus: "NORMAL", permissionVersion: BigInt(1), effectiveRoles: roles, capabilities: resolveCapabilities(roles, new Set()), specialPermissions: new Set(),
    selfPersonId: "p", townshipAreaIds: ["town-a"], departmentAreaIds: ["town-a", "town-b"], hasGlobalPublished: true, hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"), hasSystem: roles.includes("SUPER_ADMIN"), currentBatchMember: false, configurationIssues: [] };
}

describe("C-M3-004 monthly reporting rules", () => {
  it("uses exact Shanghai natural-month boundaries and current asOf", () => {
    const past = resolveMonthlyPeriod("2026-06", new Date("2026-08-28T12:00:00+08:00"));
    expect(past.monthStart.toISOString()).toBe("2026-05-31T16:00:00.000Z");
    expect(past.monthEndExclusive.toISOString()).toBe("2026-06-30T16:00:00.000Z");
    expect(past.asOf.toISOString()).toBe("2026-06-30T15:59:59.999Z");
    const current = resolveMonthlyPeriod("2026-08", new Date("2026-08-28T09:30:00+08:00"));
    expect(current.current).toBe(true); expect(current.asOfDate).toBe("2026-08-28");
  });

  it("centralizes the fixed role scope matrix and unions area roles", () => {
    expect(resolveMonthlyReportScope(actor(["ADMIN"]))).toEqual({ countyWide: true, areaIds: [] });
    expect(resolveMonthlyReportScope(actor(["GROUP_LEADER"]))).toEqual({ countyWide: true, areaIds: [] });
    expect(resolveMonthlyReportScope(actor(["MINISTER"]))).toEqual({ countyWide: true, areaIds: [] });
    expect(resolveMonthlyReportScope(actor(["TOWNSHIP_STAFF", "DEPARTMENT_STAFF"]))).toEqual({ countyWide: false, areaIds: ["town-a", "town-b"] });
    expect(() => resolveSelectedAreaIds(resolveMonthlyReportScope(actor(["TOWNSHIP_STAFF"])), "town-b")).toThrow();
    expect(() => resolveMonthlyReportScope(actor(["MEMBER_CURRENT"]))).toThrow();
    expect(canDownloadMonthlyReport(actor(["MEMBER_CURRENT"]))).toBe(false);
  });

  it("reconstructs status, batch, stale and outcome due only from facts at asOf", () => {
    const asOf = new Date("2026-06-30T23:59:59.999+08:00");
    expect(statusAt([{ toState: "IN_PROGRESS", createdAt: new Date("2026-06-20T10:00:00+08:00") }, { toState: "COMPLETED", createdAt: new Date("2026-07-02T10:00:00+08:00") }], asOf)).toBe("IN_PROGRESS");
    expect(resolveDemandBatchAt({ creationBatchId: "A", ownerHistories: [{ personId: "p", batchId: "B", effectiveAt: new Date("2026-06-15T00:00:00+08:00"), expiredAt: new Date("2026-07-01T00:00:00+08:00") }], asOf })).toBe("B");
    expect(resolveDemandBatchAt({ creationBatchId: "A", ownerHistories: [{ personId: "p", batchId: "B", effectiveAt: new Date("2026-05-01T00:00:00+08:00"), expiredAt: new Date("2026-06-01T00:00:00+08:00") }], asOf })).toBeNull();
    expect(getDemandProgressFreshnessAt({ status: "IN_PROGRESS", progresses: [{ createdAt: new Date("2026-05-30T12:00:00+08:00") }], responsibilityBaselines: [], asOf }).stale).toBe(true);
    expect(outcomePlanAt({ trackingMode: "TRACKING", decidedAt: new Date("2026-05-01"), firstTrackingDate: new Date("2026-06-01"), approvedRounds: [{ roundNo: 1, reviewedAt: new Date("2026-06-10"), nextTrackingDate: new Date("2026-06-28"), endTracking: false }], asOf })).toEqual({ status: "IN_PROGRESS", nextDueDate: new Date("2026-06-28") });
  });

  it("converts exact Decimal cents only while they remain safe Excel numbers", () => {
    expect(decimalStringToSafeExcelNumber("0.10")).toBe(0.1);
    expect(decimalStringToSafeExcelNumber("0.20")).toBe(0.2);
    expect(decimalStringToSafeExcelNumber("100.20")).toBe(100.2);
    expect(decimalStringToSafeExcelNumber("90071992547409.91")).toBe(Number("90071992547409.91"));
    expect(() => decimalStringToSafeExcelNumber("90071992547409.92")).toThrowError("REPORT_EXCEL_MONEY_PRECISION_UNSAFE");
  });

  it("uses the smallest Trip node sequence as the one formal business date", () => {
    expect(getTripBusinessDate([
      { id: "later", sequenceNo: 2, plannedStartAt: new Date("2026-07-01T09:00:00+08:00") },
      { id: "first", sequenceNo: 1, plannedStartAt: new Date("2026-06-30T09:00:00+08:00") },
    ])?.toISOString()).toBe("2026-06-30T01:00:00.000Z");
  });

  it("builds exactly five safe sheets and keeps displayed money at two decimals", async () => {
    const data: MonthlyReportData = { period: { month: "2026-06", asOf: "2026-06-30", current: false }, filters: { batchId: null, batchName: null, areaIds: null, areaNames: [] },
      overview: { demand: { added: 1, completed: 0, stock: { IN_PROGRESS: 1 }, stale: 0, outcomeDue: 0 }, resources: { enterpriseTotal: 1, enterpriseNormal: 1, memberCount: 1, arrivalVisits: 0, presentPeople: 0 }, trips: { tripCount: 0, participantVisits: 0, distinctParticipants: 0, distinctEnterprises: 0, leadCount: 0 }, talent: { added: 0, completedRounds: 0, inProgressRounds: 0, domestic: 0, overseas: 0 }, outcome: { contractAmount: "0.10", investmentAmount: "0.20", policyFund: "100.20", costReduction: "0.00", talentIntroduced: 0, patent: 0 } },
      rows: { demands: [{ businessNo: "=HYPERLINK(\"x\")", title: "+malicious", enterprise: "-unsafe", area: "@unsafe" }], trips: [], talents: [], outcomes: [{ businessNo: "XQ1", contractAmount: "100.20", investmentAmount: "0.20", policyFund: "0.10", costReduction: "0.00" }] }, warnings: [] };
    const buffer = await buildMonthlyWorkbook(data); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer as never);
    expect(workbook.worksheets.map(({ name }) => name)).toEqual(MONTHLY_REPORT_SHEETS);
    expect(workbook.getWorksheet("需求进展")?.getCell("A2").value).toBe("'=HYPERLINK(\"x\")");
    expect(workbook.getWorksheet("需求进展")?.getCell("B2").value).toBe("'+malicious");
    expect(workbook.getWorksheet("需求进展")?.getCell("C2").value).toBe("'-unsafe");
    expect(workbook.getWorksheet("需求进展")?.getCell("D2").value).toBe("'@unsafe");
    const overview = workbook.getWorksheet("月度概览")!;
    for (const metric of ["合同金额新增", "投资额新增", "政策资金新增", "降本新增"]) {
      const row = overview.getColumn(2).values.findIndex((value) => value === metric);
      expect(typeof overview.getCell(row, 3).value).toBe("number");
      expect(overview.getCell(row, 3).numFmt).toBe("#,##0.00");
    }
    const outcome = workbook.getWorksheet("成效跟踪")!;
    for (const column of ["H", "I", "J", "K"]) {
      expect(typeof outcome.getCell(`${column}2`).value).toBe("number");
      expect(outcome.getCell(`${column}2`).numFmt).toBe("#,##0.00");
    }
  });

  it("classifies deterministic workbook and snapshot failures as permanent jobs", async () => {
    for (const code of ["REPORT_EXCEL_MONEY_PRECISION_UNSAFE", "REPORT_QUERY_SNAPSHOT_INVALID"]) {
      const service = { processExport: async () => { throw new ReportingError(code, code); } } as unknown as ReportingService;
      await expect(new MonthlyReportExportJobHandler(service).handle({ exportTaskId: "00000000-0000-0000-0000-000000000000" })).rejects.toMatchObject({ name: "PermanentJobError", code });
    }
  });
});
