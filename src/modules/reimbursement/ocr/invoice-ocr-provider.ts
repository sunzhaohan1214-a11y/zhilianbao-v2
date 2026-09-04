import { testOnlyProviderRuntimeAllowed } from "@/runtime/zero-extra-cost-policy";

export type InvoiceOcrResult = {
  documentKind?: string;
  invoiceNo?: string;
  invoiceDate?: string;
  amount?: string;
  seller?: string;
  confidence?: number;
  raw: Record<string, unknown>;
};

export interface InvoiceOcrProvider {
  readonly name: string;
  extract(input: { body: Buffer; filename: string; mimeType: string }): Promise<InvoiceOcrResult>;
}

export class InvoiceOcrUnavailableError extends Error {}

export class DeterministicFakeInvoiceOcrProvider implements InvoiceOcrProvider {
  readonly name = "deterministic-fake";
  async extract(input: { body: Buffer; filename: string; mimeType: string }): Promise<InvoiceOcrResult> {
    const text = `${input.filename} ${input.body.toString("utf8", 0, Math.min(input.body.length, 4096))}`.toLowerCase();
    const documentKind = /taxi|ride|网约|出租/.test(text) ? "RIDE_HAILING"
      : /dining|restaurant|餐饮/.test(text) ? "DINING"
        : /train|rail|flight|air|火车|机票/.test(text) ? "PUBLIC_TRANSPORT" : "GENERAL_INVOICE";
    return { documentKind, invoiceNo: `TEST-${Buffer.from(input.filename).toString("hex").slice(0, 12).toUpperCase()}`,
      invoiceDate: "2026-08-27", amount: "100.00", seller: "测试票据供应商", confidence: 0.99, raw: { provider: this.name, documentKind } };
  }
}

export class UnavailableInvoiceOcrProvider implements InvoiceOcrProvider {
  readonly name = "unavailable";
  async extract(): Promise<InvoiceOcrResult> { throw new InvoiceOcrUnavailableError("专业票据 OCR 尚未配置"); }
}

export function getInvoiceOcrProvider(
  environment: Record<string, string | undefined> = process.env,
): InvoiceOcrProvider {
  if (testOnlyProviderRuntimeAllowed(environment)) return new DeterministicFakeInvoiceOcrProvider();
  return new UnavailableInvoiceOcrProvider();
}
