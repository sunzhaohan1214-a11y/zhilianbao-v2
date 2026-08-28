import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { UnavailableBackupProvider } from "@/modules/system/backup-provider";
import { UnavailableMaintenanceProvider } from "@/modules/system/maintenance-provider";
import { e2eUsers } from "./auth-fixtures";

const origin = "http://127.0.0.1:3000";
async function login(page: Page, user: { phone: string; password: string }) {
  const response = await page.request.post("/api/v2/auth/login", { headers: { origin }, data: user });
  expect(response.ok()).toBe(true);
}
async function post(page: Page, path: string, data: unknown, idempotent = false) {
  return page.request.post(path, { headers: { origin, ...(idempotent ? { "idempotency-key": randomUUID() } : {}) }, data });
}

test("ordinary ADMIN has no System Admin navigation or privileged APIs", async ({ page }) => {
  await login(page, e2eUsers.admin);
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: "系统治理" })).toHaveCount(0);
  for (const path of ["/api/v2/system/audit", "/api/v2/system/backups"]) {
    const response = await page.request.get(path);
    expect(response.status()).toBe(403);
  }
  const restore = await post(page, "/api/v2/system/restores/preview", { backupRecordId: randomUUID(), reason: "E2E ADMIN denied" });
  expect(restore.status()).toBe(403);
  await page.goto("/admin/system");
  await expect(page.getByRole("heading", { name: "系统治理" })).toHaveCount(0);
});

test("unconfigured production provider contracts fail closed", async () => {
  await expect(new UnavailableBackupProvider().health()).resolves.toMatchObject({ ready: false, status: "NOT_CONFIGURED" });
  await expect(new UnavailableMaintenanceProvider().health()).resolves.toMatchObject({ ready: false, status: "NOT_CONFIGURED" });
  await expect(new UnavailableBackupProvider().createSnapshot()).rejects.toThrow("BACKUP_PROVIDER_UNAVAILABLE");
});

test("SUPER exercises settings, audit, and the explicit-fake restore lifecycle", async ({ page }) => {
  const prisma = getPrismaClient(); const hiddenAttachments = await prisma.attachment.findMany({ where: { isTemporary: false, uploadStatus: "UPLOADED", scanStatus: "PASSED" }, select: { id: true } });
  await login(page, e2eUsers.superAdmin);
  await page.goto("/admin");
  await expect(page.getByRole("link", { name: "系统治理" })).toBeVisible();
  await page.goto("/admin/system");
  await expect(page.getByRole("heading", { name: "系统治理" })).toBeVisible();
  await expect(page.getByText("Runtime NOT_WIRED").first()).toBeVisible();

  const settings = await page.request.get("/api/v2/system/settings"); expect(settings.ok()).toBe(true);
  const current = (await settings.json()).data.find((item: { key: string }) => item.key === "system.admin_contact_phone");
  const reason = "E2E system setting"; const value = "0514-88889999";
  const previewResponse = await post(page, "/api/v2/system/settings/system.admin_contact_phone/preview", { value, expectedVersion: current.version, reason }); expect(previewResponse.ok()).toBe(true); const settingPreview = (await previewResponse.json()).data;
  const confirmResponse = await page.request.post("/api/v2/system/settings/system.admin_contact_phone/confirm", { headers: { origin, "idempotency-key": randomUUID() }, data: { value, expectedVersion: current.version, reason, previewToken: settingPreview.previewToken, confirm: true } }); expect(confirmResponse.ok()).toBe(true);
  expect((await page.request.get("/api/v2/system/audit")).ok()).toBe(true);

  const backupResponse = await post(page, "/api/v2/system/backups", { reason: "E2E fake restore source", confirm: true }, true); expect(backupResponse.status()).toBe(201); const backup = (await backupResponse.json()).data; expect(backup).toMatchObject({ status: "SUCCEEDED", provider: "fake", sourceEnvironment: "TEST" });
  const restorePreviewResponse = await post(page, "/api/v2/system/restores/preview", { backupRecordId: backup.id, reason: "E2E restore preview" }); expect(restorePreviewResponse.ok()).toBe(true); const restorePreview = (await restorePreviewResponse.json()).data; expect(restorePreview.canConfirm).toBe(true);
  const startResponse = await page.request.post("/api/v2/system/restores", { headers: { origin, "idempotency-key": randomUUID() }, data: { restoreRequestId: restorePreview.restoreRequestId, expectedPreviewVersion: restorePreview.previewVersion, typedConfirmation: `RESTORE ${backup.id.slice(0, 8)}`, confirm: true } }); expect(startResponse.ok()).toBe(true); expect((await startResponse.json()).data.status).toBe("EXECUTING");
  await prisma.attachment.updateMany({ where: { id: { in: hiddenAttachments.map(({ id }) => id) } }, data: { isTemporary: true } });
  try {
    const validateResponse = await post(page, `/api/v2/system/restores/${restorePreview.restoreRequestId}/validate`, {}); expect(validateResponse.ok()).toBe(true); expect((await validateResponse.json()).data.status).toBe("VALIDATION_REQUIRED");
    const completeResponse = await post(page, `/api/v2/system/restores/${restorePreview.restoreRequestId}/complete`, { manualCheckConfirmed: true, reason: "E2E manual inspection", confirm: true }); expect(completeResponse.ok()).toBe(true); expect((await completeResponse.json()).data.status).toBe("SUCCEEDED");
    expect((await page.request.get("/api/v2/system/settings")).status()).toBe(401);
  } finally {
    await prisma.attachment.updateMany({ where: { id: { in: hiddenAttachments.map(({ id }) => id) } }, data: { isTemporary: false } });
    await prisma.$disconnect();
  }
});
