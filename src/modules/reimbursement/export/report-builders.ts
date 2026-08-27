import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, type PDFFont } from "pdf-lib";
import type { ReimbursementRepository } from "../repository/reimbursement-repository";
import { REIMBURSEMENT_STATUS_LABELS } from "../constants";

type Detail = NonNullable<Awaited<ReturnType<ReimbursementRepository["findById"]>>>;
const EXPENSE_LABELS: Record<string, string> = {
  TRAVEL_TRANSPORT_ACTUAL: "交通费", TRAVEL_TRANSPORT_SUBSIDY: "交通补助", TRAVEL_MEAL_SUBSIDY: "伙食补助", TRAVEL_LODGING: "住宿费",
  DINING: "餐饮", VENUE: "场地", MATERIAL_PRODUCTION: "物料制作", SUPPLIES: "用品", LODGING: "住宿", TRANSPORTATION: "交通", OTHER: "其他",
};
const FONT_PATH = join(process.cwd(), "node_modules", "@fontsource", "noto-sans-sc", "files", "noto-sans-sc-chinese-simplified-400-normal.woff2");
function fitText(value: string, font: PDFFont, size: number, maxWidth: number) {
  if (font.widthOfTextAtSize(value, size) <= maxWidth) return value;
  let result = value;
  while (result.length && font.widthOfTextAtSize(`${result}…`, size) > maxWidth) result = result.slice(0, -1);
  return `${result}…`;
}
function frozen(item: Detail) {
  const version = item.currentSubmissionVersion;
  if (!version) throw new Error("REIMBURSEMENT_EXPORT_REQUIRES_SUBMISSION_VERSION");
  return { version, expenses: Array.isArray(version.expenseSnapshotJson) ? version.expenseSnapshotJson as Array<Record<string, unknown>> : [],
    invoices: Array.isArray(version.invoiceSnapshotJson) ? version.invoiceSnapshotJson as Array<Record<string, unknown>> : [] };
}

export async function buildReimbursementXlsx(items: readonly Detail[]) {
  const workbook = new ExcelJS.Workbook(); workbook.creator = "智链宝 V2"; workbook.created = new Date();
  const sheet = workbook.addWorksheet("报销清单", { pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true } });
  sheet.columns = [
    { header: "报销编号", key: "businessNo", width: 20 }, { header: "申请人", key: "applicant", width: 16 },
    { header: "类型", key: "type", width: 12 }, { header: "状态", key: "status", width: 24 },
    { header: "报销事由", key: "reason", width: 45 }, { header: "关联出行", key: "trip", width: 28 },
    { header: "金额", key: "amount", width: 16 }, { header: "最近提交时间", key: "submitted", width: 24 },
  ];
  for (const item of items) { const { version } = frozen(item); const trip = version.tripSnapshotJson as { title?: string } | null;
    sheet.addRow({ businessNo: item.businessNo, applicant: item.applicant.name, type: item.type,
      status: item.status, reason: version.reasonSnapshot, trip: trip?.title ?? "", amount: Number(version.totalAmount), submitted: version.submittedAt.toISOString() }); }
  sheet.getRow(1).font = { bold: true }; sheet.getRow(1).alignment = { vertical: "middle", horizontal: "center" };
  sheet.getColumn("amount").numFmt = "¥#,##0.00"; sheet.autoFilter = { from: "A1", to: "H1" }; sheet.views = [{ state: "frozen", ySplit: 1 }];
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export async function buildReimbursementPdf(item: Detail) {
  const { version, expenses, invoices } = frozen(item); const trip = version.tripSnapshotJson as { title?: string; purpose?: string; nodes?: Array<{ locationName?: string; content?: string; enterprise?: { name?: string } | null }>; participants?: Array<{ person?: { name?: string } }> } | null;
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit); pdf.setTitle("报销明细汇总表"); pdf.setSubject("仅供内部材料核对，不作为正式财务凭证");
  const page = pdf.addPage([595.28, 841.89]); const font = await pdf.embedFont(await readFile(FONT_PATH), { subset: true }); let y = 790;
  page.drawText("报销明细汇总表", { x: 220, y, size: 18, font }); y -= 40;
  const rows = [["报销编号", item.businessNo], ["申请人", item.applicant.name], ["报销类型", item.type === "TRAVEL" ? "差旅报销" : "活动报销"],
    ["材料流转状态", REIMBURSEMENT_STATUS_LABELS[item.status]], ["报销事由", version.reasonSnapshot], ["关联行程", trip?.title ?? "未关联"], ["总金额", `人民币 ${version.totalAmount.toString()} 元`]];
  for (const [label, value] of rows) { page.drawText(`${label}：`, { x: 55, y, size: 11, font }); page.drawText(fitText(value, font, 11, 375), { x: 165, y, size: 11, font }); y -= 27; }
  if (trip) { const participants = trip.participants?.map((entry) => entry.person?.name).filter(Boolean).join("、") || "无";
    page.drawText(fitText(`提交时行程快照｜参与人员：${participants}`, font, 9, 485), { x: 55, y, size: 9, font }); y -= 17;
    for (const node of trip.nodes ?? []) { const location = node.enterprise?.name ?? node.locationName ?? "未填写地点"; const content = node.content ?? "未填写工作内容";
      page.drawText(fitText(`行程节点：${location}｜${content}`, font, 8, 485), { x: 55, y, size: 8, font }); y -= 15; } }
  y -= 10; page.drawText("费用明细", { x: 55, y, size: 12, font }); y -= 24;
  for (const expense of expenses) { const type = String(expense.expenseType); page.drawText(fitText(`${EXPENSE_LABELS[type] ?? type}　人民币 ${String(expense.amount)} 元`, font, 9, 465), { x: 65, y, size: 9, font }); y -= 18; if (y < 70) break; }
  if (item.type === "TRAVEL") {
    const subtotal = (type: string) => expenses.filter((expense) => expense.expenseType === type).reduce((sum, expense) => sum + Number(expense.amount ?? 0), 0).toFixed(2);
    y -= 8; for (const [label, type] of [["交通费小计", "TRAVEL_TRANSPORT_ACTUAL"], ["交通补助小计", "TRAVEL_TRANSPORT_SUBSIDY"], ["伙食补助小计", "TRAVEL_MEAL_SUBSIDY"], ["住宿费小计", "TRAVEL_LODGING"]]) { page.drawText(`${label}：人民币 ${subtotal(type)} 元`, { x: 65, y, size: 9, font }); y -= 17; }
  }
  y -= 5; page.drawText(fitText(`发票号码：${invoices.map((invoice) => String(invoice.confirmedInvoiceNo ?? "")).filter(Boolean).join("、") || "无"}`, font, 9, 485), { x: 55, y, size: 9, font });
  page.drawText("仅供内部材料核对，不作为正式财务凭证", { x: 185, y: 45, size: 8, font });
  return Buffer.from(await pdf.save());
}
