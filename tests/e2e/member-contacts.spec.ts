import { expect, test, type Page } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { enterpriseE2e, e2eUsers, seedAuthFixtures } from "./auth-fixtures";

test.describe.configure({ mode: "serial" });
async function login(page: Page, user: { phone: string; password: string }) {
  await page.goto("/login"); await page.getByLabel("手机号").fill(user.phone); await page.getByLabel("密码", { exact: true }).fill(user.password);
  await Promise.all([page.waitForResponse((response) => response.url().endsWith("/api/v2/auth/login")), page.getByRole("button", { name: "登录" }).click()]);
}
test.beforeEach(async () => {
  await seedAuthFixtures();
  await getPrismaClient().attachmentLink.deleteMany({
    where: {
      entityType: "PERSON",
      relationType: "AVATAR",
      entityId: { in: Object.values(e2eUsers).map(({ personId }) => personId) },
    },
  });
});

test("internal member browses current/alumni, sees phone and separate minister label", async ({ page }) => {
  await login(page, e2eUsers.normal); await page.goto("/resources/members");
  await expect(page.getByRole("heading", { name: "团员" })).toBeVisible();
  await expect(page.getByText("E2E normal", { exact: true })).toBeVisible();
  await expect(page.getByText("部长", { exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("搜索姓名")).toBeVisible();
  await page.goto(`/resources/members?kind=current&keyword=${encodeURIComponent(e2eUsers.normal.phone)}`); await expect(page.getByText("E2E normal", { exact: true })).toHaveCount(0);
  await page.goto(`/resources/members?kind=current&keyword=${encodeURIComponent("E2E normal")}`); await expect(page.getByText("E2E normal", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "往届" }).click(); await expect(page.getByText("E2E admin", { exact: true })).toBeVisible();
  await page.goto(`/resources/members/${e2eUsers.normal.personId}`); await expect(page.getByText(e2eUsers.normal.phone)).toBeVisible();
  await page.goto(`/resources/contacts?organizationId=${enterpriseE2e.organizationId}`); await expect(page.getByText("E2E normal · 挂职专员", { exact: true })).toBeVisible(); await expect(page.getByText(e2eUsers.normal.phone)).toBeVisible(); await expect(page.getByText("E2E admin · 历史任职", { exact: true })).toHaveCount(0);
});

test("member list renders an authorized photo and keeps a text fallback", async ({ page }) => {
  await login(page, e2eUsers.normal);
  const uploaded = await page.evaluate(async () => {
    const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const intent = await fetch("/api/v2/attachments/upload-intent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ filename: "synthetic-member-avatar.png", declaredMimeType: "image/png", expectedSizeBytes: atob(base64).length }) });
    const intentJson = await intent.json();
    const attachmentId = intentJson.data.attachmentId as string;
    await fetch(`/api/v2/test/attachments/${attachmentId}/upload`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ base64 }) });
    await fetch(`/api/v2/attachments/${attachmentId}/complete`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const scan = await fetch(`/api/v2/test/attachments/${attachmentId}/scan`, { method: "POST" });
    if (!scan.ok) throw new Error("avatar scan failed");
    return attachmentId;
  });
  const prisma = getPrismaClient();
  await prisma.attachmentLink.create({ data: { attachmentId: uploaded, entityType: "PERSON", entityId: e2eUsers.normal.personId, relationType: "AVATAR", createdByPersonId: e2eUsers.admin.personId } });
  await prisma.attachment.update({ where: { id: uploaded }, data: { isTemporary: false } });
  await page.goto("/resources/members");
  const avatar = page.getByRole("img", { name: "E2E normal头像" });
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("E2E minister头像占位", { exact: true })).toHaveCount(1);
  await page.context().clearCookies();
  expect((await page.request.get(`/api/v2/attachments/${uploaded}/content`)).status()).toBe(401);
});

test("member edits only capability profile and cannot mutate batch, phone or roles", async ({ page }) => {
  await login(page, e2eUsers.normal); await page.goto("/me/capability-profile");
  await page.getByLabel("专业方向").fill("智能制造与工业软件"); await page.getByLabel("可协调资源").fill("产业链技术专家"); await page.getByLabel("智能制造").check(); await page.getByLabel("技术").check();
  const saved = page.waitForResponse((response) => response.url().includes("/capability-profile") && response.request().method() === "POST"); await page.getByRole("button", { name: "保存能力画像" }).click(); expect((await saved).status()).toBe(200); await expect(page.getByText("能力画像已保存")).toBeVisible();
  const statuses = await page.evaluate(async ({ personId, batchId }) => {
    const massAssignment = await fetch("/api/v2/members/me/capability-profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ professionalDirection: "越权", phone: "13900000000", industryIds: [], preferredDemandTypes: [] }) });
    const membership = await fetch(`/api/v2/admin/members/${personId}/memberships`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId, startDate: "2026-01-01", status: "ACTIVE" }) });
    const leader = await fetch(`/api/v2/admin/batches/${batchId}/group-leader`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ASSIGN", personId, reason: "越权" }) });
    return [massAssignment.status, membership.status, leader.status];
  }, { personId: e2eUsers.normal.personId, batchId: enterpriseE2e.batchId });
  expect(statuses).toEqual([400, 403, 403]);
});

test("admin manages membership and Super replaces group leader without changing MINISTER", async ({ page }) => {
  await login(page, e2eUsers.admin);
  const managed = await page.evaluate(async (personId) => {
    const created = await fetch("/api/v2/admin/batches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "E2E 延任批次", year: 2027, startDate: "2027-01-01", endDate: "2027-12-31" }) });
    const batchId = (await created.json()).data.id as string;
    const membership = await fetch(`/api/v2/admin/members/${personId}/memberships`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ batchId, startDate: "2027-01-01", endDate: "2027-12-31", status: "ACTIVE" }) });
    return { create: created.status, membership: membership.status, batchId };
  }, e2eUsers.normal.personId);
  expect(managed.create).toBe(201); expect(managed.membership).toBe(201);
  await page.goto("/admin/batches");
  await expect(page.getByRole("button", { name: /切换至/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "任命团长", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "撤销当前团长", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `关闭 E2E 延任批次`, exact: true })).toBeVisible();
  const forbidden = await page.evaluate(async ({ batchId, personId }) => {
    const activate = await fetch(`/api/v2/admin/batches/${batchId}/activate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirmation: "ACTIVATE", expectedCurrentBatchId: batchId }) });
    const leader = await fetch(`/api/v2/admin/batches/${batchId}/group-leader`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ASSIGN", personId, reason: "ADMIN 越权" }) });
    return [activate.status, leader.status];
  }, { batchId: enterpriseE2e.batchId, personId: e2eUsers.normal.personId });
  expect(forbidden).toEqual([403, 403]);
  await page.context().clearCookies(); await login(page, e2eUsers.superAdmin);
  await page.goto("/admin/batches");
  await expect(page.getByRole("button", { name: `切换至 E2E 延任批次`, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "任命团长", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销当前团长", exact: true })).toBeVisible();
  const assigned = await page.evaluate(async ({ batchId, personId }) => (await fetch(`/api/v2/admin/batches/${batchId}/group-leader`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ASSIGN", personId, reason: "E2E Super 任命" }) })).status, { batchId: enterpriseE2e.batchId, personId: e2eUsers.normal.personId });
  expect(assigned).toBe(200); await page.goto("/resources/members");
  await expect(page.getByText("团长", { exact: true })).toBeVisible(); await expect(page.getByText("部长", { exact: true })).toBeVisible();
});
