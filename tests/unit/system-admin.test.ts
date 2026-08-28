import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AI_CAPABILITY_ALLOWLIST } from "@/modules/system/ai-config-service";
import { redactAuditValue } from "@/modules/system/audit-query-service";
import { FakeBackupProvider, UnavailableBackupProvider } from "@/modules/system/backup-provider";
import { stableHash } from "@/modules/system/command";
import { aiConfigSchema } from "@/modules/system/schemas";
import { SYSTEM_SETTING_REGISTRY } from "@/modules/system/setting-registry";
import { FakeMaintenanceProvider, UnavailableMaintenanceProvider } from "@/modules/system/maintenance-provider";
import { isDefaultWorkday } from "@/modules/system/work-calendar-service";
import { InMemoryStorageAdapter } from "@/modules/attachment/storage/in-memory-storage-adapter";
import { backupPolicyCompliance } from "@/modules/system/backup-service";
import { restoreConfirmSchema, settingConfirmSchema, settingPreviewSchema } from "@/modules/system/schemas";

describe("M3-007 system governance pure contracts", () => {
  it("keeps the setting registry typed, finite, and secret-free", () => {
    expect(SYSTEM_SETTING_REGISTRY["demand.claim_cycle_natural_days"].default).toBe(30);
    expect(SYSTEM_SETTING_REGISTRY["demand.review_sla_normal_workdays"].default).toBe(3);
    expect(SYSTEM_SETTING_REGISTRY["demand.review_sla_urgent_workdays"].default).toBe(1);
    expect(SYSTEM_SETTING_REGISTRY["system.business_timezone"]).toMatchObject({ default: "Asia/Shanghai", editable: false });
    expect(Object.keys(SYSTEM_SETTING_REGISTRY).some((key) => /secret|database_url|api_key/i.test(key))).toBe(false);
  });
  it("uses Asia/Shanghai natural-date weekday defaults", () => { expect(isDefaultWorkday("2026-08-28")).toBe(true); expect(isDefaultWorkday("2026-08-29")).toBe(false); });
  it("canonicalizes nested preview payloads", () => { expect(stableHash({ b: { y: 2, x: 1 }, a: 1 })).toBe(stableHash({ a: 1, b: { x: 1, y: 2 } })); expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 })); });
  it("requires setting versions and explicit preview confirmation", () => { expect(settingPreviewSchema.safeParse({ value: 31, expectedVersion: 0, reason: "test" }).success).toBe(true); expect(settingConfirmSchema.safeParse({ value: 31, expectedVersion: 0, reason: "test", previewToken: "a".repeat(64), confirm: true }).success).toBe(true); expect(settingConfirmSchema.safeParse({ value: 31, expectedVersion: 0, reason: "test", previewToken: "a".repeat(64) }).success).toBe(false); });
  it("redacts secrets, phones, prompts, invoice bodies, and private AI content recursively", () => { expect(redactAuditValue({ phone: "13800000000", nested: { apiKey: "secret", prompt: "private", safeStatus: "FAILED" }, invoiceBody: "票据" })).toEqual({ phone: "[REDACTED]", nested: { apiKey: "[REDACTED]", prompt: "[REDACTED]", safeStatus: "FAILED" }, invoiceBody: "[REDACTED]" }); });
  it("allows only fixed AI capabilities and secret reference names", () => { expect(AI_CAPABILITY_ALLOWLIST).toContain("DEMAND_MATCH"); expect(AI_CAPABILITY_ALLOWLIST).not.toContain("AUTO_APPROVE_DEMAND"); expect(() => aiConfigSchema.parse({ capability: "DEMAND_MATCH", provider: "test", model: "test", retentionPolicy: "NONE", trainingOptOut: true, secretRef: "raw-secret-value!", expectedVersion: 0, reason: "test" })).toThrow(); });
  it("fails closed without production providers and supports deterministic test providers", async () => { expect(await new UnavailableBackupProvider().health()).toMatchObject({ ready: false, status: "NOT_CONFIGURED" }); expect(await new UnavailableMaintenanceProvider().health()).toMatchObject({ ready: false }); const backup = new FakeBackupProvider(); const snapshot = await backup.createSnapshot({ backupType: "MANUAL", reason: "TEST", idempotencyKey: "one" }); expect(snapshot.status).toBe("SUCCEEDED"); const operation = await backup.startRestore(snapshot.providerBackupId, "restore-one"); expect(await backup.getRestoreStatus(operation.operationId)).toEqual({ status: "SUCCEEDED" }); const maintenance = new FakeMaintenanceProvider(); await maintenance.enter({ operationId: "restore-one", reason: "TEST" }); expect(await maintenance.status()).toMatchObject({ active: true }); await maintenance.exit("restore-one"); expect(await maintenance.status()).toEqual({ active: false, operationId: undefined }); });
  it("uses a non-destructive storage readiness probe", async () => { const storage = new InMemoryStorageAdapter(); expect(await storage.healthProbe()).toEqual({ configured: true, reachable: true }); expect(await storage.headObject("system-health/nonexistent-probe")).toEqual({ exists: false, sizeBytes: 0 }); });
  it("reports backup policy without inventing provider readiness", () => { const now = new Date("2026-08-28T12:00:00.000Z"); expect(backupPolicyCompliance(false, new Date("2026-08-28T11:00:00.000Z"), now).compliance).toBe("UNKNOWN"); expect(backupPolicyCompliance(true, new Date("2026-08-28T00:00:00.000Z"), now)).toMatchObject({ ageHours: 12, compliance: "COMPLIANT" }); expect(backupPolicyCompliance(true, null, now).compliance).toBe("DEGRADED"); });
  it("requires the exact typed restore confirmation contract", () => { expect(restoreConfirmSchema.safeParse({ restoreRequestId: randomUUID(), expectedPreviewVersion: 1, typedConfirmation: "RESTORE 12345678", confirm: true }).success).toBe(true); expect(restoreConfirmSchema.safeParse({ restoreRequestId: randomUUID(), expectedPreviewVersion: 1, typedConfirmation: "RESTORE 12345678", confirm: false }).success).toBe(false); });
});
