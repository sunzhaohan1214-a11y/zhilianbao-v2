import { describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { PDFDocument } from "pdf-lib";
import {
  DeterministicFakeInvoiceOcrProvider,
  UnavailableInvoiceOcrProvider,
  getInvoiceOcrProvider,
} from "@/modules/reimbursement/ocr/invoice-ocr-provider";
import { classifyInvoiceOcr } from "@/modules/reimbursement/ocr/invoice-ocr-service";
import { reimbursementDraftSchema, reimbursementExportSchema } from "@/modules/reimbursement/schemas";
import { validateReimbursementExpenses } from "@/modules/reimbursement/reimbursement-service";
import { buildReimbursementPdf, buildReimbursementXlsx } from "@/modules/reimbursement/export/report-builders";
import { ReimbursementOcrJobHandler } from "@/modules/jobs/handlers/reimbursement-ocr-handler";
import { ReimbursementExportJobHandler } from "@/modules/jobs/handlers/reimbursement-export-handler";
import { isSubmitIdempotencyUniqueConflict } from "@/modules/reimbursement/errors";
import { resolveCapabilities } from "@/modules/permissions/role-capabilities";
import { OUTBOX_EVENT_TYPES, outboxPayloadSchemas } from "@/modules/outbox/outbox-types";

describe("B-M3-001 reimbursement rules", () => {
  it("keeps the automatic fake OCR provider out of production runtimes", () => {
    expect(getInvoiceOcrProvider({ APP_ENV: "test" })).toBeInstanceOf(DeterministicFakeInvoiceOcrProvider);
    expect(getInvoiceOcrProvider({ APP_ENV: "local" })).toBeInstanceOf(DeterministicFakeInvoiceOcrProvider);
    expect(getInvoiceOcrProvider({ APP_ENV: "test", NODE_ENV: "production" })).toBeInstanceOf(UnavailableInvoiceOcrProvider);
    expect(getInvoiceOcrProvider({ APP_ENV: "prod", NODE_ENV: "test" })).toBeInstanceOf(UnavailableInvoiceOcrProvider);
    expect(getInvoiceOcrProvider({})).toBeInstanceOf(UnavailableInvoiceOcrProvider);
  });

  it("accepts only the exact four travel expense types", () => {
    const draft = reimbursementDraftSchema.parse({ type: "TRAVEL", reason: "赴外招商", expenses: [
      { expenseType: "TRAVEL_TRANSPORT_ACTUAL", amount: "188.50" },
      { expenseType: "TRAVEL_TRANSPORT_SUBSIDY", amount: "160", referenceRate: "80", claimedDays: "2" },
      { expenseType: "TRAVEL_MEAL_SUBSIDY", amount: "200", referenceRate: "100", claimedDays: "2" },
      { expenseType: "TRAVEL_LODGING", amount: "360" },
    ] });
    expect(() => validateReimbursementExpenses(draft.type, draft.expenses)).not.toThrow();
    expect(() => validateReimbursementExpenses("TRAVEL", [{ expenseType: "DINING", amount: "10", source: "MANUAL" }])).toThrow(/不匹配/);
  });

  it("keeps both subsidy categories manual and limited to 80 or 100 reference rates", () => {
    expect(() => validateReimbursementExpenses("TRAVEL", [{ expenseType: "TRAVEL_MEAL_SUBSIDY", amount: "90", source: "OCR", referenceRate: "90", claimedDays: "1" }])).toThrow(/手工/);
    expect(() => validateReimbursementExpenses("TRAVEL", [{ expenseType: "TRAVEL_MEAL_SUBSIDY", amount: "100", source: "MANUAL", referenceRate: "100", claimedDays: "1" }])).not.toThrow();
  });

  it("requires a custom name for activity OTHER", () => {
    expect(() => validateReimbursementExpenses("ACTIVITY", [{ expenseType: "OTHER", amount: "25", source: "MANUAL" }])).toThrow(/费用名称/);
  });

  it("keeps A4 PDF single-record and XLSX multi-record exports distinct", () => {
    expect(reimbursementExportSchema.safeParse({ format: "PDF", reimbursementIds: [crypto.randomUUID(), crypto.randomUUID()] }).success).toBe(false);
    expect(reimbursementExportSchema.safeParse({ format: "XLSX", reimbursementIds: [crypto.randomUUID(), crypto.randomUUID()] }).success).toBe(true);
  });

  it("maps reimbursement.apply to the complete applicant mutation chain while alumni retain self history viewing", () => {
    const capabilities = resolveCapabilities(["MEMBER_ALUMNI_PLATFORM"], new Set(["reimbursement.apply"]));
    expect([...capabilities]).toEqual(expect.arrayContaining([
      "reimbursement.create", "reimbursement.view.self", "reimbursement.edit.self", "reimbursement.submit", "reimbursement.withdraw",
    ]));
    expect(resolveCapabilities(["MEMBER_ALUMNI_PLATFORM"], new Set()).has("reimbursement.view.self")).toBe(true);
    expect(resolveCapabilities(["MEMBER_ALUMNI_PLATFORM"], new Set()).has("reimbursement.submit")).toBe(false);
  });

  it("declares strict privacy-minimal reimbursement outbox payloads", () => {
    expect(OUTBOX_EVENT_TYPES).toEqual(expect.arrayContaining(["REIMBURSEMENT_SUBMITTED", "REIMBURSEMENT_STATE_CORRECTED"]));
    const payload = { reimbursementId: crypto.randomUUID(), applicantPersonId: crypto.randomUUID(), managerRecipientIds: [crypto.randomUUID()], eventKey: "v1" };
    expect(outboxPayloadSchemas.REIMBURSEMENT_SUBMITTED.safeParse(payload).success).toBe(true);
    expect(outboxPayloadSchemas.REIMBURSEMENT_SUBMITTED.safeParse({ ...payload, amount: "999.00" }).success).toBe(false);
    expect(outboxPayloadSchemas.REIMBURSEMENT_RETURNED.safeParse({ ...payload, reason: "private" }).success).toBe(false);
  });

  it("uses deterministic professional-provider fake results in tests", async () => {
    const provider = new DeterministicFakeInvoiceOcrProvider();
    await expect(provider.extract({ body: Buffer.from("ride"), filename: "taxi.pdf", mimeType: "application/pdf" })).resolves.toMatchObject({ documentKind: "RIDE_HAILING", amount: "100.00" });
  });

  it("never suggests taxi, ride-hailing or dining invoices as travel reimbursement", () => {
    expect(classifyInvoiceOcr("RIDE_HAILING", "TRAVEL")).toMatchObject({ suggestedExpenseType: null, warning: expect.stringMatching(/出租车|网约车/) });
    expect(classifyInvoiceOcr("DINING", "TRAVEL")).toMatchObject({ suggestedExpenseType: null, warning: expect.stringMatching(/餐饮/) });
    expect(classifyInvoiceOcr("PUBLIC_TRANSPORT", "TRAVEL")).toEqual({ suggestedExpenseType: "TRAVEL_TRANSPORT_ACTUAL", warning: null });
  });

  it("builds A4 PDF and XLSX strictly from the immutable current version", async () => {
    const item = { businessNo: "BX-2026-000001", type: "TRAVEL", status: "PAPER_RECEIVED", applicant: { name: "Applicant" }, linkedTrip: null, expenses: [], invoices: [],
      totalAmount: { toString: () => "999.00" }, lastSubmittedAt: new Date(), currentSubmissionVersion: { reasonSnapshot: "Frozen reason", tripSnapshotJson: { title: "Frozen trip" },
        expenseSnapshotJson: [{ expenseType: "TRAVEL_TRANSPORT_ACTUAL", amount: "188.50" }, { expenseType: "TRAVEL_TRANSPORT_SUBSIDY", amount: "80.00" }, { expenseType: "TRAVEL_MEAL_SUBSIDY", amount: "100.00" }, { expenseType: "TRAVEL_LODGING", amount: "360.00" }],
        invoiceSnapshotJson: [{ confirmedInvoiceNo: "INV-001" }], totalAmount: { toString: () => "728.50" }, submittedAt: new Date("2026-08-27T00:00:00Z") } };
    const pdfBytes = await buildReimbursementPdf(item as never); const pdf = await PDFDocument.load(pdfBytes); expect(pdf.getPage(0).getSize()).toMatchObject({ width: 595.28, height: 841.89 }); expect(pdf.getTitle()).toBe("报销明细汇总表"); expect(pdf.getSubject()).toBe("仅供内部材料核对，不作为正式财务凭证"); expect(pdfBytes.byteLength).toBeGreaterThan(10_000);
    const xlsxBytes = await buildReimbursementXlsx([item as never]); const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(xlsxBytes as never); expect(workbook.getWorksheet("报销清单")?.getCell("E2").value).toBe("Frozen reason"); expect(workbook.getWorksheet("报销清单")?.getCell("G2").value).toBe(728.5);
  });

  it("renders every large-record expense, invoice and trip node across multiple A4 pages", async () => {
    const expenseSnapshotJson = Array.from({ length: 40 }, (_, index) => ({ expenseType: "TRAVEL_TRANSPORT_ACTUAL", amount: `${index + 1}.00`, description: `完整费用明细-${index + 1}-${"说明".repeat(30)}` }));
    const invoiceSnapshotJson = Array.from({ length: 30 }, (_, index) => ({ confirmedInvoiceNo: `LONG-INVOICE-${String(index + 1).padStart(3, "0")}` }));
    const nodes = Array.from({ length: 24 }, (_, index) => ({ locationName: `行程节点-${index + 1}`, content: `完整工作内容-${index + 1}-${"内容".repeat(24)}` }));
    const item = { businessNo: "BX-2026-009999", type: "TRAVEL", status: "PAPER_RECEIVED", applicant: { name: "Applicant" }, linkedTrip: null, expenses: [], invoices: [], totalAmount: { toString: () => "820.00" }, lastSubmittedAt: new Date(),
      currentSubmissionVersion: { reasonSnapshot: "多页完整性回归", tripSnapshotJson: { title: "长行程", nodes, participants: [] }, expenseSnapshotJson, invoiceSnapshotJson, totalAmount: { toString: () => "820.00" }, submittedAt: new Date() } };
    const pdf = await PDFDocument.load(await buildReimbursementPdf(item as never));
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    for (const page of pdf.getPages()) expect(page.getSize()).toMatchObject({ width: 595.28, height: 841.89 });
  });

  it("dispatches OCR and export work through dedicated worker handlers", async () => {
    const ocr = { process: vi.fn().mockResolvedValue(undefined) }; const exporter = { process: vi.fn().mockResolvedValue(undefined) };
    await new ReimbursementOcrJobHandler(ocr as never).handle({ invoiceId: crypto.randomUUID() });
    await new ReimbursementExportJobHandler(exporter as never).handle({ exportTaskId: crypto.randomUUID() });
    expect(ocr.process).toHaveBeenCalledOnce(); expect(exporter.process).toHaveBeenCalledOnce();
  }, 30_000);

  it("recognizes only the nested submit idempotency unique target from Prisma MySQL", () => {
    expect(isSubmitIdempotencyUniqueConflict({ code: "P2002", meta: { driverAdapterError: { cause: { constraint: { fields: ["actor_person_id", "idempotency_key_hash"] } } } } })).toBe(true);
    expect(isSubmitIdempotencyUniqueConflict({ code: "P2002", meta: { target: ["business_no"] } })).toBe(false);
  });
});
