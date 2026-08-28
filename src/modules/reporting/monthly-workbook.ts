import ExcelJS from "exceljs";
import { escapeExcelFormula } from "@/modules/import-export/export-service";

export const MONTHLY_REPORT_SHEETS = ["月度概览", "需求进展", "走访与行程", "人才对接", "成效跟踪"] as const;

export type DataQualityWarning = { code: string; count: number; message: string };
export type MonthlyReportData = {
  period: { month: string; asOf: string; current: boolean };
  filters: { batchId: string | null; batchName: string | null; areaIds: string[] | null; areaNames: string[] };
  overview: {
    demand: { added: number; completed: number; stock: Record<string, number>; stale: number; outcomeDue: number };
    resources: { enterpriseTotal: number; enterpriseNormal: number; memberCount: number; arrivalVisits: number; presentPeople: number };
    trips: { tripCount: number; participantVisits: number; distinctParticipants: number; distinctEnterprises: number; leadCount: number };
    talent: { added: number; completedRounds: number; inProgressRounds: number; domestic: number; overseas: number };
    outcome: { contractAmount: string; investmentAmount: string; policyFund: string; costReduction: string; talentIntroduced: number; patent: number };
  };
  rows: {
    demands: Array<Record<string, string | number | boolean | null>>;
    trips: Array<Record<string, string | number | null>>;
    talents: Array<Record<string, string | number | null>>;
    outcomes: Array<Record<string, string | number | null>>;
  };
  warnings: DataQualityWarning[];
};

const COLORS = { navy: "1E3A5F", blue: "DCEAF7", pale: "F5F8FB", white: "FFFFFF", gray: "64748B" };

function safe(value: unknown): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean" || value instanceof Date) return value;
  return escapeExcelFormula(value);
}

function styleTable(sheet: ExcelJS.Worksheet, widths: number[]) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getRow(1).font = { bold: true, color: { argb: COLORS.white } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.navy } };
  sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.getRow(1).height = 24;
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  if (sheet.columnCount > 0) sheet.autoFilter = { from: "A1", to: `${sheet.getColumn(sheet.columnCount).letter}1` };
  sheet.eachRow((row, rowNumber) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (rowNumber > 1 && rowNumber % 2 === 0) row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.pale } };
  });
}

function addObjectSheet(workbook: ExcelJS.Workbook, name: string, columns: Array<{ header: string; key: string; width: number; money?: boolean }>, rows: Array<Record<string, unknown>>) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = columns.map(({ header, key, width }) => ({ header, key, width }));
  for (const row of rows) {
    const added = sheet.addRow(Object.fromEntries(columns.map(({ key }) => [key, safe(row[key])])));
    columns.forEach((column, index) => { if (column.money) added.getCell(index + 1).numFmt = "#,##0.00"; });
  }
  styleTable(sheet, columns.map(({ width }) => width));
  return sheet;
}

export async function buildMonthlyWorkbook(data: MonthlyReportData): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "智链宝 V2";
  workbook.created = new Date(`${data.period.month}-01T00:00:00.000+08:00`);
  workbook.calcProperties.fullCalcOnLoad = false;

  const overview = workbook.addWorksheet(MONTHLY_REPORT_SHEETS[0]);
  overview.columns = [{ width: 18 }, { width: 34 }, { width: 20 }, { width: 54 }];
  overview.addRow(["分组", "指标", "数值", "统计口径"]);
  const stock = data.overview.demand.stock;
  const entries: Array<[string, string, string | number, string]> = [
    ["基本信息", "月份", data.period.month, data.period.current ? `截至当前（${data.period.asOf}）` : `月末时点（${data.period.asOf}）`],
    ["基本信息", "范围", data.filters.areaNames.length ? data.filters.areaNames.join("、") : "全县", "按当前授权范围与任务范围快照的交集"],
    ["基本信息", "批次", data.filters.batchName ?? "全部/时点批次", "新增按 creationBatch；办结按 completionBatch；存量按 as-of batch"],
    ["需求", "本月新增", data.overview.demand.added, "firstPublishedAt，按 Demand.id 去重"],
    ["需求", "本月办结", data.overview.demand.completed, "管理员 Close APPROVE reviewedAt，按 Demand.id 去重"],
    ...["PENDING_REVIEW", "RETURNED", "PENDING_CLAIM", "IN_PROGRESS", "PENDING_CLOSE_REVIEW"].map((status) => ["需求", `月末 ${status}`, stock[status] ?? 0, "StateTransitionHistory as-of 互斥主状态"] as [string, string, number, string]),
    ["需求", "久未更新", data.overview.demand.stale, "IN_PROGRESS 子集；超过30个上海自然日"],
    ["需求", "待成效跟踪", data.overview.demand.outcomeDue, "TRACKING 且 as-of 待跟踪/跟踪中、到期"],
    ["资源与人员", "企业总数", data.overview.resources.enterpriseTotal, "Enterprise.id 去重"],
    ["资源与人员", "有效企业数", data.overview.resources.enterpriseNormal, "EnterpriseVersion as-of status=NORMAL"],
    ["资源与人员", "当前/选定批次团员", data.overview.resources.memberCount, "Batch + Membership as-of，Person.id 去重"],
    ["资源与人员", "本月到宝人次", data.overview.resources.arrivalVisits, "V2 PresenceReport.id，取消记录排除"],
    ["资源与人员", "月末在宝人数", data.overview.resources.presentPeople, "V2 PresenceReport，Person.id 去重"],
    ["工作行程", "行程次数", data.overview.trips.tripCount, "Trip.id 去重"],
    ["工作行程", "参与人次", data.overview.trips.participantVisits, "有效 TripParticipant 关系数"],
    ["工作行程", "去重参与人数", data.overview.trips.distinctParticipants, "Person.id 去重"],
    ["工作行程", "去重走访企业数", data.overview.trips.distinctEnterprises, "Enterprise.id 去重"],
    ["工作行程", "形成需求线索数", data.overview.trips.leadCount, "MEMBER_VISIT DemandLead.id"],
    ["人才", "本月新增人才", data.overview.talent.added, "Talent.createdAt；区域报表仅可靠归属"],
    ["人才", "本月完成对接", data.overview.talent.completedRounds, "TalentTownshipRound.completedAt"],
    ["人才", "月末对接中", data.overview.talent.inProgressRounds, "Round status as-of=IN_PROGRESS"],
    ["人才", "国内/海外", `${data.overview.talent.domestic}/${data.overview.talent.overseas}`, "Talent.scopeType"],
    ["成效", "合同金额新增", data.overview.outcome.contractAmount, "APPROVED Round increment（Decimal）"],
    ["成效", "投资额新增", data.overview.outcome.investmentAmount, "APPROVED Round increment（Decimal）"],
    ["成效", "政策资金新增", data.overview.outcome.policyFund, "APPROVED Round increment（Decimal）"],
    ["成效", "降本新增", data.overview.outcome.costReduction, "APPROVED Round increment（Decimal）"],
    ["成效", "引进人才新增", data.overview.outcome.talentIntroduced, "APPROVED Round increment"],
    ["成效", "专利新增", data.overview.outcome.patent, "APPROVED Round increment"],
  ];
  entries.forEach((entry) => overview.addRow(entry.map(safe)));
  overview.addRow([]);
  overview.addRow(["数据质量说明", "代码", "数量", "说明"]);
  data.warnings.forEach((warning) => overview.addRow(["数据质量说明", safe(warning.code), warning.count, safe(warning.message)]));
  styleTable(overview, [18, 34, 20, 54]);

  addObjectSheet(workbook, MONTHLY_REPORT_SHEETS[1], [
    { header: "业务编号", key: "businessNo", width: 18 }, { header: "标题", key: "title", width: 32 }, { header: "企业", key: "enterprise", width: 26 }, { header: "负责镇区", key: "area", width: 18 },
    { header: "需求类型", key: "demandType", width: 14 }, { header: "紧急程度", key: "urgency", width: 12 }, { header: "本月新增?", key: "added", width: 12 }, { header: "本月办结?", key: "completed", width: 12 },
    { header: "月末状态", key: "statusAt", width: 22 }, { header: "月末久未更新?", key: "stale", width: 16 }, { header: "月末待成效?", key: "outcomeDue", width: 16 }, { header: "责任模式/安全姓名 as-of", key: "responsibility", width: 28 },
    { header: "最后进展日期 <= asOf", key: "lastProgressAt", width: 22 }, { header: "完成日期", key: "completedAt", width: 16 }, { header: "创建批次", key: "creationBatch", width: 20 }, { header: "办结批次", key: "completionBatch", width: 20 },
  ], data.rows.demands);
  addObjectSheet(workbook, MONTHLY_REPORT_SHEETS[2], [
    { header: "日期", key: "date", width: 16 }, { header: "行程ID/摘要", key: "trip", width: 32 }, { header: "参与人员", key: "participants", width: 32 }, { header: "走访企业", key: "enterprises", width: 34 },
    { header: "负责镇区", key: "areas", width: 22 }, { header: "走访结果摘要", key: "result", width: 46 }, { header: "形成线索数", key: "leadCount", width: 14 },
  ], data.rows.trips);
  addObjectSheet(workbook, MONTHLY_REPORT_SHEETS[3], [
    { header: "人才", key: "talent", width: 20 }, { header: "国内/海外", key: "scope", width: 14 }, { header: "单位", key: "organization", width: 28 }, { header: "专业方向", key: "direction", width: 34 },
    { header: "镇区", key: "area", width: 18 }, { header: "轮次", key: "roundNo", width: 10 }, { header: "状态", key: "status", width: 16 }, { header: "开始日期", key: "startedAt", width: 16 },
    { header: "完成日期", key: "completedAt", width: 16 }, { header: "当前安全责任人", key: "handler", width: 20 }, { header: "结果摘要", key: "result", width: 46 },
  ], data.rows.talents);
  addObjectSheet(workbook, MONTHLY_REPORT_SHEETS[4], [
    { header: "需求编号", key: "businessNo", width: 18 }, { header: "需求标题", key: "title", width: 30 }, { header: "企业", key: "enterprise", width: 26 }, { header: "负责镇区", key: "area", width: 18 },
    { header: "Round No", key: "roundNo", width: 12 }, { header: "trackingDate", key: "trackingDate", width: 16 }, { header: "trackingBatch", key: "trackingBatch", width: 20 },
    { header: "合同金额新增", key: "contractAmount", width: 18, money: true }, { header: "投资额新增", key: "investmentAmount", width: 18, money: true }, { header: "政策资金新增", key: "policyFund", width: 18, money: true }, { header: "降本新增", key: "costReduction", width: 18, money: true },
    { header: "引进人才新增", key: "talentIntroduced", width: 16 }, { header: "专利新增", key: "patent", width: 14 }, { header: "定性成效", key: "qualitativeResult", width: 42 }, { header: "企业反馈", key: "enterpriseFeedback", width: 42 }, { header: "审核时间", key: "reviewedAt", width: 22 },
  ], data.rows.outcomes.map((row) => ({ ...row, contractAmount: Number(row.contractAmount), investmentAmount: Number(row.investmentAmount), policyFund: Number(row.policyFund), costReduction: Number(row.costReduction) })));

  if (workbook.worksheets.map(({ name }) => name).join("|") !== MONTHLY_REPORT_SHEETS.join("|")) throw new Error("MONTHLY_REPORT_SHEET_CONTRACT_BROKEN");
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
