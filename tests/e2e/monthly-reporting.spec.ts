import { expect, test, type Page } from "@playwright/test";
import { e2eUsers, enterpriseE2e } from "./auth-fixtures";

async function login(page: Page, user: { phone: string; password: string }) {
  await page.goto("/login"); await page.getByLabel("手机号").fill(user.phone); await page.getByLabel("密码", { exact: true }).fill(user.password);
  await Promise.all([page.waitForResponse((response) => response.url().endsWith("/api/v2/auth/login")), page.getByRole("button", { name: "登录" }).click()]);
}

test("ADMIN previews, exports and receives an authorized private output", async ({ page }) => {
  await login(page, e2eUsers.admin); await page.goto("/reports/monthly");
  await expect(page.getByRole("heading", { name: "月度工作台账" })).toBeVisible(); await expect(page.getByRole("heading", { name: /排名/ })).toHaveCount(0);
  await page.getByRole("button", { name: "结构化预览" }).click(); await expect(page.getByText("固定五张工作表")).toBeVisible();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/v2/reports/monthly/exports") && response.request().method() === "POST");
  await page.getByRole("button", { name: "生成五表 Excel" }).click(); const response = await responsePromise; const created = await response.json() as { data: { id: string } };
  await page.evaluate(async (id) => { await fetch(`/api/v2/test/monthly-report-exports/${id}/run`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); }, created.data.id);
  await expect(page.getByRole("button", { name: "安全下载" })).toBeVisible();
  const authorized = await page.evaluate(async (id) => {
    const detail = await fetch(`/api/v2/reports/monthly/exports/${id}`); const task = await detail.json() as { data: { outputAttachmentId: string } };
    const access = await fetch(`/api/v2/attachments/${task.data.outputAttachmentId}/access?action=download`);
    return { detailStatus: detail.status, accessStatus: access.status };
  }, created.data.id);
  expect(authorized).toEqual({ detailStatus: 200, accessStatus: 200 });
});

for (const [label, user] of [["GROUP_LEADER", e2eUsers.groupLeader], ["MINISTER", e2eUsers.ministerOnly]] as const) {
  test(`${label} reaches county report without admin shell`, async ({ page }) => { await login(page, user); await page.goto("/reports/monthly"); await expect(page.getByRole("heading", { name: "月度工作台账" })).toBeVisible(); await expect(page.getByLabel("镇区范围").locator("option", { hasText: "全县" })).toHaveCount(1); await page.getByRole("button", { name: "结构化预览" }).click(); await expect(page.getByRole("button", { name: "生成五表 Excel" })).toBeVisible(); });
}

test("TOWNSHIP and DEPARTMENT are area-scoped and tampering is rejected", async ({ browser }) => {
  for (const user of [e2eUsers.township, e2eUsers.department]) {
    const page = await browser.newPage(); await login(page, user); await page.goto("/reports/monthly"); await expect(page.getByRole("heading", { name: "月度工作台账" })).toBeVisible();
    const tamperStatus = await page.evaluate(async (areaId) => (await fetch(`/api/v2/reports/monthly?month=2026-08&areaId=${areaId}`)).status, enterpriseE2e.areaBId);
    expect(tamperStatus).toBe(403); await page.close();
  }
});

test("ordinary current member has no batch report", async ({ page }) => {
  await login(page, e2eUsers.normal); await page.goto("/me"); await expect(page.getByRole("link", { name: /月度工作台账/ })).toHaveCount(0);
  await page.goto("/reports/monthly"); await expect(page.getByText("当前账号不能查看月度工作台账")).toBeVisible();
});
