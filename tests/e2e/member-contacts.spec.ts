import { expect, test, type Page } from "@playwright/test";
import { enterpriseE2e, e2eUsers, seedAuthFixtures } from "./auth-fixtures";

test.describe.configure({ mode: "serial" });
async function login(page: Page, user: { phone: string; password: string }) {
  await page.goto("/login"); await page.getByLabel("手机号").fill(user.phone); await page.getByLabel("密码", { exact: true }).fill(user.password);
  await Promise.all([page.waitForResponse((response) => response.url().endsWith("/api/v2/auth/login")), page.getByRole("button", { name: "登录" }).click()]);
}
test.beforeEach(async () => { await seedAuthFixtures(); });

test("internal member browses current/alumni, sees phone and separate minister label", async ({ page }) => {
  await login(page, e2eUsers.normal); await page.goto("/resources/members");
  await expect(page.getByRole("heading", { name: "团员" })).toBeVisible();
  await expect(page.getByText("E2E normal", { exact: true })).toBeVisible();
  await expect(page.getByText("部长", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "往届" }).click(); await expect(page.getByText("E2E admin", { exact: true })).toBeVisible();
  await page.goto(`/resources/members/${e2eUsers.normal.personId}`); await expect(page.getByText(e2eUsers.normal.phone)).toBeVisible();
  await page.goto(`/resources/contacts?organizationId=${enterpriseE2e.organizationId}`); await expect(page.getByText("E2E normal · 挂职专员", { exact: true })).toBeVisible(); await expect(page.getByText(e2eUsers.normal.phone)).toBeVisible(); await expect(page.getByText("E2E admin · 历史任职", { exact: true })).toHaveCount(0);
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
    return { create: created.status, membership: membership.status };
  }, e2eUsers.normal.personId);
  expect(managed).toEqual({ create: 201, membership: 201 });
  await page.context().clearCookies(); await login(page, e2eUsers.superAdmin);
  const assigned = await page.evaluate(async ({ batchId, personId }) => (await fetch(`/api/v2/admin/batches/${batchId}/group-leader`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "ASSIGN", personId, reason: "E2E Super 任命" }) })).status, { batchId: enterpriseE2e.batchId, personId: e2eUsers.normal.personId });
  expect(assigned).toBe(200); await page.goto("/resources/members");
  await expect(page.getByText("团长", { exact: true })).toBeVisible(); await expect(page.getByText("部长", { exact: true })).toBeVisible();
});
