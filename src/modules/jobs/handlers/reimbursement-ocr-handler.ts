import { InvoiceOcrService } from "@/modules/reimbursement/ocr/invoice-ocr-service";
import { RetryableJobError } from "../errors"; import type { JobHandler } from "../handler-registry";
export class ReimbursementOcrJobHandler implements JobHandler<"REIMBURSEMENT_INVOICE_OCR"> {
  constructor(private readonly service = new InvoiceOcrService()) {}
  async handle(payload: { invoiceId: string }) { try { await this.service.process(payload.invoiceId); } catch (error) { throw new RetryableJobError("REIMBURSEMENT_OCR_TRANSIENT", "票据 OCR 暂时失败", { cause: error }); } }
}
