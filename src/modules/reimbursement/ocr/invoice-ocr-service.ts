import { Prisma, type ReimbursementExpenseType } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { InvoiceOcrUnavailableError, getInvoiceOcrProvider, type InvoiceOcrProvider } from "./invoice-ocr-provider";

export function classifyInvoiceOcr(documentKind: string | undefined, reimbursementType: "TRAVEL" | "ACTIVITY"):
  { suggestedExpenseType: ReimbursementExpenseType | null; warning: string | null } {
  const kind = documentKind?.toUpperCase() ?? "";
  if (/RIDE|TAXI/.test(kind)) return { suggestedExpenseType: reimbursementType === "ACTIVITY" ? "TRANSPORTATION" : null, warning: "出租车/网约车票据不得计入出行交通费实报实销，请人工核对" };
  if (/DINING|RESTAURANT/.test(kind)) return { suggestedExpenseType: reimbursementType === "ACTIVITY" ? "DINING" : null, warning: "餐饮票据不能作为出行报销费用，请人工核对" };
  if (/HOTEL|LODGING/.test(kind)) return { suggestedExpenseType: reimbursementType === "TRAVEL" ? "TRAVEL_LODGING" : "LODGING", warning: null };
  if (/PUBLIC_TRANSPORT|TRAIN|FLIGHT/.test(kind)) return reimbursementType === "TRAVEL"
    ? { suggestedExpenseType: "TRAVEL_TRANSPORT_ACTUAL", warning: null }
    : { suggestedExpenseType: "TRANSPORTATION", warning: null };
  return { suggestedExpenseType: null, warning: "票据类型无法可靠归类，请人工确认" };
}

export class InvoiceOcrService {
  constructor(private readonly provider: InvoiceOcrProvider = getInvoiceOcrProvider()) {}
  async process(invoiceId: string) {
    const prisma = getPrismaClient();
    const invoice = await prisma.reimbursementInvoice.findUnique({ where: { id: invoiceId }, include: { reimbursement: { select: { type: true } }, attachment: true } });
    if (!invoice || !["QUEUED", "PROCESSING", "FAILED"].includes(invoice.ocrStatus)) return;
    await prisma.reimbursementInvoice.update({ where: { id: invoice.id }, data: { ocrStatus: "PROCESSING" } });
    try {
      if (!invoice.attachment.objectKey || invoice.attachment.scanStatus !== "PASSED") throw new Error("INVOICE_ATTACHMENT_NOT_READY");
      const body = await getAttachmentRuntime().storage.readObject(invoice.attachment.objectKey);
      const result = await this.provider.extract({ body, filename: invoice.attachment.originalFilename, mimeType: invoice.attachment.detectedMimeType ?? invoice.attachment.declaredMimeType });
      const classification = classifyInvoiceOcr(result.documentKind, invoice.reimbursement.type);
      const confidenceWarning = result.confidence !== undefined && result.confidence < 0.8 ? "OCR 置信度较低，请逐项核对" : null;
      await prisma.reimbursementInvoice.update({ where: { id: invoice.id }, data: { ocrStatus: "READY", suggestedExpenseType: classification.suggestedExpenseType,
        ocrRawJson: { raw: result.raw, extracted: { documentKind: result.documentKind, invoiceNo: result.invoiceNo, invoiceDate: result.invoiceDate,
          amount: result.amount, seller: result.seller }, confidence: result.confidence } as Prisma.InputJsonValue,
        ocrWarning: [classification.warning, confidenceWarning].filter(Boolean).join("；") || null } });
    } catch (error) {
      await prisma.reimbursementInvoice.update({ where: { id: invoice.id }, data: { ocrStatus: error instanceof InvoiceOcrUnavailableError ? "DEGRADED" : "FAILED",
        ocrWarning: error instanceof InvoiceOcrUnavailableError ? "专业票据 OCR 未配置，已降级为人工录入" : "OCR 识别失败，请人工录入" } });
      if (!(error instanceof InvoiceOcrUnavailableError)) throw error;
    }
  }
}
