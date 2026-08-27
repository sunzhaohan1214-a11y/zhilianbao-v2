import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts } from "pdf-lib";
import type { ReimbursementRepository } from "../repository/reimbursement-repository";

type Detail = NonNullable<Awaited<ReturnType<ReimbursementRepository["findById"]>>>;
const pdfText = (value: string | undefined, fallback: string) => value && /^[\x20-\x7E]*$/.test(value) ? value : fallback;
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
  const pdf = await PDFDocument.create(); pdf.setTitle("报销明细汇总表"); pdf.setSubject("仅供内部材料核对，不作为正式财务凭证");
  const page = pdf.addPage([595.28, 841.89]); const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold); let y = 790;
  page.drawText("ZHILIANBAO REIMBURSEMENT FORM", { x: 150, y, size: 16, font: bold }); y -= 40;
  const rows = [["Business No", item.businessNo], ["Applicant", pdfText(item.applicant.name, "Applicant")],
    ["Type", item.type], ["Status", item.status], ["Reason", pdfText(version.reasonSnapshot, "Reimbursement purpose (see system record)")],
    ["Linked Trip", pdfText(trip?.title, trip ? "Linked trip (see frozen snapshot)" : "-")], ["Total", `CNY ${version.totalAmount.toString()}`]];
  for (const [label, value] of rows) { page.drawText(`${label}:`, { x: 55, y, size: 11, font: bold }); page.drawText(value.slice(0, 72), { x: 165, y, size: 11, font }); y -= 27; }
  if (trip) { page.drawText(`Trip participants: ${trip.participants?.map((entry) => pdfText(entry.person?.name, "participant")).join(", ") || "-"}`, { x: 55, y, size: 9, font }); y -= 17;
    for (const node of trip.nodes ?? []) { page.drawText(`Trip node: ${pdfText(node.enterprise?.name ?? node.locationName, "location in frozen snapshot")} - ${pdfText(node.content, "work content in frozen snapshot")}`.slice(0, 90), { x: 55, y, size: 8, font }); y -= 15; } }
  y -= 10; page.drawText("Expense details", { x: 55, y, size: 12, font: bold }); y -= 24;
  for (const expense of expenses) { page.drawText(`${String(expense.expenseType)}   CNY ${String(expense.amount)}`, { x: 65, y, size: 9, font }); y -= 18; if (y < 70) break; }
  if (item.type === "TRAVEL") {
    const subtotal = (type: string) => expenses.filter((expense) => expense.expenseType === type).reduce((sum, expense) => sum + Number(expense.amount ?? 0), 0).toFixed(2);
    y -= 8; for (const [label, type] of [["Transport actual subtotal", "TRAVEL_TRANSPORT_ACTUAL"], ["Transport subsidy subtotal", "TRAVEL_TRANSPORT_SUBSIDY"], ["Meal subsidy subtotal", "TRAVEL_MEAL_SUBSIDY"], ["Lodging subtotal", "TRAVEL_LODGING"]]) { page.drawText(`${label}: CNY ${subtotal(type)}`, { x: 65, y, size: 9, font: bold }); y -= 17; }
  }
  y -= 5; page.drawText(`Invoice numbers: ${invoices.map((invoice) => String(invoice.confirmedInvoiceNo ?? "")).filter(Boolean).join(", ") || "-"}`, { x: 55, y, size: 9, font });
  page.drawText("Internal material review only; not an official financial voucher.", { x: 55, y: 45, size: 8, font });
  return Buffer.from(await pdf.save());
}
