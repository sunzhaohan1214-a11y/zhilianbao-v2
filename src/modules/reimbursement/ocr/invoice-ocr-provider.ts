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

export class HttpInvoiceOcrProvider implements InvoiceOcrProvider {
  readonly name = "configured-http-invoice-ocr";
  constructor(private readonly endpoint: string, private readonly apiKey: string) {}
  async extract(input: { body: Buffer; filename: string; mimeType: string }): Promise<InvoiceOcrResult> {
    const response = await fetch(this.endpoint, { method: "POST", headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ filename: input.filename, mimeType: input.mimeType, contentBase64: input.body.toString("base64") }), signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`INVOICE_OCR_HTTP_${response.status}`);
    const data = await response.json() as Partial<InvoiceOcrResult>;
    return { documentKind: data.documentKind, invoiceNo: data.invoiceNo, invoiceDate: data.invoiceDate, amount: data.amount, seller: data.seller,
      confidence: typeof data.confidence === "number" ? data.confidence : undefined, raw: data.raw ?? data as Record<string, unknown> };
  }
}

export class UnavailableInvoiceOcrProvider implements InvoiceOcrProvider {
  readonly name = "unavailable";
  async extract(): Promise<InvoiceOcrResult> { throw new InvoiceOcrUnavailableError("专业票据 OCR 尚未配置"); }
}

export function getInvoiceOcrProvider(): InvoiceOcrProvider {
  if (process.env.APP_ENV === "test") return new DeterministicFakeInvoiceOcrProvider();
  const endpoint = process.env.INVOICE_OCR_ENDPOINT; const apiKey = process.env.INVOICE_OCR_API_KEY;
  return endpoint && apiKey ? new HttpInvoiceOcrProvider(endpoint, apiKey) : new UnavailableInvoiceOcrProvider();
}
