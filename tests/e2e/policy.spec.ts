import { expect, test, type Page } from "@playwright/test";
import { e2eUsers, policyE2e, seedAuthFixtures } from "./auth-fixtures";

test.describe.configure({ mode: "serial" });
async function login(page: Page, user: { phone: string; password: string }) {
  await page.goto("/login"); await page.getByLabel("手机号").fill(user.phone); await page.getByLabel("密码", { exact: true }).fill(user.password);
  await Promise.all([page.waitForResponse((response) => response.url().endsWith("/api/v2/auth/login")), page.getByRole("button", { name: "登录" }).click()]);
}
test.beforeEach(async () => { await seedAuthFixtures(); });

test("admin creates, extracts, confirms and publishes; member reads file; replacement never auto-restores", async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, e2eUsers.admin); await page.goto("/admin/policies/new");
  await page.getByLabel("政策名称").fill("E2E 新政策"); await page.getByLabel("发布部门").fill("宝应县工业和信息化局"); await page.getByLabel("发布时间").fill("2026-08-27"); await page.getByLabel("发布层级").fill("县级"); await page.getByLabel("科技创新").check();
  await page.getByLabel("主政策文件").setInputFiles({ name: "新政策.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 E2E policy primary") });
  await page.getByLabel("补充附件（可多选）").setInputFiles({ name: "补充材料.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 E2E policy supplementary") });
  await page.getByRole("button", { name: "创建政策草稿" }).click(); await page.waitForURL(/\/admin\/policies\/[0-9a-f-]{36}$/); const policyId = page.url().split("/").at(-1)!;
  await expect(page.getByText("DRAFT/CURRENT")).toBeVisible(); await page.getByRole("button", { name: "AI 提取" }).click(); await expect(page.getByLabel("适用对象")).toHaveValue("AI 候选适用对象");
  await page.getByRole("button", { name: "管理员人工确认" }).click(); await expect(page.getByText("当前版本已人工确认，如需修改请建立新内容版本。")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "发布政策" }).click(); await expect(page.getByText("PUBLISHED/CURRENT")).toBeVisible();

  await page.context().clearCookies(); await login(page, e2eUsers.normal); await page.goto("/resources/policies"); await expect(page.getByRole("link", { name: /E2E 新政策/ })).toBeVisible(); await page.getByRole("link", { name: /E2E 新政策/ }).click();
  await expect(page.getByText("AI 智能解读，仅供内部辅助")).toBeVisible(); const access = page.waitForResponse((response) => response.url().includes("/api/v2/attachments/") && new URL(response.url()).pathname.endsWith("/access")); await page.getByRole("button", { name: "新政策.pdf" }).click(); expect((await access).status()).toBe(200);
  const forbidden = await page.evaluate(async (id) => (await fetch(`/api/v2/admin/policies/${id}/withdraw`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "越权" }) })).status, policyId); expect(forbidden).toBe(403);

  await page.context().clearCookies(); await login(page, e2eUsers.admin); await page.goto(`/admin/policies/${policyId}`); await page.locator('select[name="oldPolicyId"]').selectOption(policyE2e.oldPolicyId); await page.locator('form:has(select[name="oldPolicyId"]) input[name="reason"]').fill("E2E 正式替代依据"); page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "确认替代" }).click(); await expect(page.getByText("操作成功")).toBeVisible();
  await page.goto(`/admin/policies/${policyE2e.oldPolicyId}`); await expect(page.getByText("PUBLISHED/REPLACED")).toBeVisible();
  await page.goto(`/admin/policies/${policyId}`); await page.locator('form:has(button:has-text("撤回政策")) input[name="reason"]').fill("E2E 发布错误"); page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "撤回政策" }).click(); await expect(page.getByText("WITHDRAWN/CURRENT")).toBeVisible();
  await page.goto(`/admin/policies/${policyE2e.oldPolicyId}`); await expect(page.getByText("PUBLISHED/REPLACED")).toBeVisible();
  await page.goto(`/admin/policies/${policyId}`); const endForm = page.locator('form:has-text("解除：")').first(); await endForm.locator('input[name="reason"]').fill("E2E 管理员依据正式材料恢复"); await endForm.locator('input[name="restore"]').check(); page.once("dialog", (dialog) => dialog.accept()); await endForm.getByRole("button", { name: "解除关系" }).click(); await expect(page.getByText("操作成功")).toBeVisible();
  await page.goto(`/admin/policies/${policyE2e.oldPolicyId}`); await expect(page.getByText("PUBLISHED/CURRENT")).toBeVisible();
});
