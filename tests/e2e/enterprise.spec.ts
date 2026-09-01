import { expect, test, type Page } from "@playwright/test";
import { enterpriseE2e, e2eUsers, seedAuthFixtures } from "./auth-fixtures";

test.describe.configure({ mode: "serial" });
async function login(page: Page, user: { phone: string; password: string }) {
  await page.goto("/login"); await page.getByLabel("手机号").fill(user.phone); await page.getByLabel("密码", { exact: true }).fill(user.password);
  await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/v2/auth/login")), page.getByRole("button", { name: "登录" }).click()]);
}
test.beforeEach(async () => { await seedAuthFixtures(); });

test("member reads enterprise and phone, submits correction, and cannot govern", async ({ page }) => {
  await login(page, e2eUsers.normal); await page.goto("/resources/enterprises");
  await expect(page.getByRole("heading", { name: "企业名录" })).toBeVisible(); await page.getByRole("link", { name: /宝应智造示范企业/ }).click();
  await expect(page.getByText("13800003001")).toBeVisible(); await page.getByRole("button", { name: "提交纠错" }).click();
  await page.getByLabel("企业地址").fill("宝应县安宜镇纠错地址2号");
  const correction = page.waitForResponse((r) => r.url().endsWith("/api/v2/enterprise-change-requests") && r.request().method() === "POST");
  await page.getByRole("button", { name: "确认提交" }).click(); expect((await correction).status()).toBe(201); await expect(page.getByText("纠错申请已提交。")).toBeVisible();
  await page.goto("/admin/enterprises"); await expect(page.getByRole("heading", { name: "当前账号不能进入管理后台" })).toBeVisible();
  const forbidden = await page.evaluate(async (id) => (await fetch(`/api/v2/enterprises/${id}/disable`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "越权" }) })).status, enterpriseE2e.enterpriseId);
  expect(forbidden).toBe(403);
});

test("township submits only its area and manages only its enterprise contacts", async ({ page }) => {
  await login(page, e2eUsers.township); await page.goto("/resources/enterprises/apply");
  await page.getByLabel("企业名称").fill("E2E 镇区申请企业"); await page.getByLabel("所属区域").selectOption(enterpriseE2e.areaAId); await page.getByLabel("企业地址").fill("宝应县安宜镇申请路8号"); await page.getByLabel("主要产品/服务").fill("绿色制造服务");
  const submitted = page.waitForResponse((r) => r.url().endsWith("/api/v2/enterprise-change-requests") && r.request().method() === "POST"); await page.getByRole("button", { name: "提交企业新增申请" }).click(); expect((await submitted).status()).toBe(201);
  const checks = await page.evaluate(async ({ areaBId, enterpriseId }) => {
    const crossArea = await fetch("/api/v2/enterprise-change-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestType: "CREATE", proposedAreaId: areaBId, payload: { enterprise: { name: "越区申请", responsibleAreaId: areaBId, address: "地址", mainProducts: "产品", tagIds: [] } } }) });
    const ownContact = await fetch(`/api/v2/enterprises/${enterpriseId}/contacts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "镇区联系人", phone: "13800003002", setPrimary: false }) }); return { crossArea: crossArea.status, ownContact: ownContact.status };
  }, { areaBId: enterpriseE2e.areaBId, enterpriseId: enterpriseE2e.enterpriseId });
  expect(checks).toEqual({ crossArea: 403, ownContact: 201 });
});

test("admin approves create, manages primary contact, and disables/restores", async ({ page }) => {
  await login(page, e2eUsers.township);
  const created = await page.evaluate(async (areaId) => { const response = await fetch("/api/v2/enterprise-change-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ requestType: "CREATE", proposedAreaId: areaId, payload: { enterprise: { name: "E2E 审核通过企业", responsibleAreaId: areaId, address: "宝应县审核路1号", mainProducts: "精密制造", tagIds: [] } } }) }); return (await response.json()).data.id as string; }, enterpriseE2e.areaAId);
  await page.context().clearCookies(); await login(page, e2eUsers.admin); await page.goto(`/admin/enterprise-change-requests/${created}`); await expect(page.getByRole("heading", { name: "企业新增申请" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("E2E 审核通过")); const approved = page.waitForResponse((r) => r.url().endsWith(`/enterprise-change-requests/${created}/review`)); await page.getByRole("button", { name: "通过" }).click();
  expect((await approved).status()).toBe(200); await page.goto("/admin/enterprises?keyword=E2E%20审核通过企业"); await expect(page.getByRole("link", { name: "E2E 审核通过企业" })).toBeVisible();
  await page.goto(`/admin/enterprises/${enterpriseE2e.enterpriseId}`); await page.getByPlaceholder("姓名").fill("李总"); await page.getByPlaceholder("手机或座机").fill("13800003003"); await page.getByRole("button", { name: "新增联系人" }).click(); await expect(page.getByText(/李总/)).toBeVisible(); await page.getByText(/李总/).locator("..").getByRole("button", { name: "设为主要" }).click();
  await page.getByPlaceholder("操作原因").fill("E2E 停用验证"); await page.getByRole("button", { name: "停用企业" }).click(); await expect(page.getByText("已停用", { exact: true })).toBeVisible();
  await page.getByPlaceholder("操作原因").fill("E2E 恢复验证"); await page.getByRole("button", { name: "恢复企业" }).click(); await expect(page.getByText("正常", { exact: true })).toBeVisible();
});

test("minister can read but has no governance UI or API", async ({ page }) => {
  await login(page, e2eUsers.minister); await page.goto(`/resources/enterprises/${enterpriseE2e.enterpriseId}`); await expect(page.getByRole("heading", { name: "宝应智造示范企业" })).toBeVisible(); await expect(page.getByText("13800003001")).toBeVisible();
  await page.goto("/admin/enterprises"); await expect(page.getByRole("heading", { name: "当前账号不能进入管理后台" })).toBeVisible();
  const status = await page.evaluate(async (id) => (await fetch(`/api/v2/enterprises/${id}/formal-correction`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes: { address: "越权" }, reason: "越权" }) })).status, enterpriseE2e.enterpriseId); expect(status).toBe(403);
});
