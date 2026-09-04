import { describe, expect, it } from "vitest";
import { assertZeroExtraCostPolicy } from "@/runtime/zero-extra-cost-policy";

describe("zero extra cost policy", () => {
  it("accepts the disabled providers and local memory storage", () => {
    expect(() => assertZeroExtraCostPolicy({
      BACKUP_PROVIDER: "unavailable",
      ATTACHMENT_STORAGE_PROVIDER: "memory",
    })).not.toThrow();
  });

  it.each([
    "CYNOSDB_CLUSTER_ID",
    "TENCENTCLOUD_SECRET_ID",
    "COS_SECRET_ID",
    "ZLB_RUNTIME_SECRET_ID",
    "INVOICE_OCR_ENDPOINT",
    "NEXT_PUBLIC_TENCENT_MAP_KEY",
  ])("rejects the legacy paid setting %s without exposing its value", (key) => {
    const secretValue = "must-not-appear";
    expect(() => assertZeroExtraCostPolicy({ [key]: secretValue })).toThrow(`EXTRA_PAID_PROVIDER_DISABLED:${key}`);
    try {
      assertZeroExtraCostPolicy({ [key]: secretValue });
    } catch (error) {
      expect(String(error)).not.toContain(secretValue);
    }
  });

  it("rejects non-local backup and attachment providers", () => {
    expect(() => assertZeroExtraCostPolicy({ BACKUP_PROVIDER: "tencent-cynosdb" }))
      .toThrow("EXTRA_PAID_PROVIDER_DISABLED:BACKUP_PROVIDER");
    expect(() => assertZeroExtraCostPolicy({ ATTACHMENT_STORAGE_PROVIDER: "cos" }))
      .toThrow("EXTRA_PAID_PROVIDER_DISABLED:ATTACHMENT_STORAGE_PROVIDER");
  });
});
