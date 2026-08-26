import { expect, test, type Page } from "@playwright/test";
import { seedAuthFixtures, e2eUsers } from "./auth-fixtures";

test.describe.configure({ mode: "serial" });

async function login(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("手机号").fill(phone);
  await page.getByLabel("密码", { exact: true }).fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith("/api/v2/auth/login") && candidate.request().method() === "POST"),
    page.getByRole("button", { name: "登录" }).click(),
  ]);
  expect(response.ok()).toBe(true);
  await expect(page).not.toHaveURL(/\/login$/);
}

test.beforeEach(async () => {
  await seedAuthFixtures();
});

test("unauthenticated business access is redirected to login", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "登录智链宝" })).toBeVisible();
});

test("first activation changes password, confirms confidentiality, then supports normal relogin", async ({ page }) => {
  const user = e2eUsers.unactivated;
  await login(page, user.phone, user.password);
  await expect(page).toHaveURL(/\/account\/activate$/);
  await page.getByLabel("新密码", { exact: true }).fill("Activated-pass-123");
  await page.getByLabel("确认新密码").fill("Activated-pass-123");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "完成激活" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "首页" })).toBeVisible();

  await page.goto("/account/security");
  await page.getByRole("button", { name: "退出当前设备" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, user.phone, "Activated-pass-123");
  await expect(page).toHaveURL(/\/$/);
});

test("a reset account is restricted to forced password change", async ({ page }) => {
  const user = e2eUsers.forced;
  await login(page, user.phone, user.password);
  await expect(page).toHaveURL(/\/account\/change-password$/);
  await expect(page.getByRole("heading", { name: "请先修改密码" })).toBeVisible();
  await page.goto("/demands");
  await expect(page).toHaveURL(/\/account\/change-password$/);
});

test("unified permission service protects the admin shell for every key role", async ({ browser }) => {
  for (const user of [e2eUsers.normal, e2eUsers.minister, e2eUsers.groupLeader]) {
    const deniedContext = await browser.newContext();
    const denied = await deniedContext.newPage();
    await login(denied, user.phone, user.password);
    await denied.goto("/admin");
    await expect(denied.getByRole("heading", { name: "当前账号不能进入管理后台" })).toBeVisible();
    await deniedContext.close();
  }

  for (const user of [e2eUsers.admin, e2eUsers.superAdmin]) {
    const allowedContext = await browser.newContext();
    const allowed = await allowedContext.newPage();
    await login(allowed, user.phone, user.password);
    await allowed.goto("/admin");
    await expect(allowed.getByRole("heading", { name: "管理后台基础骨架" })).toBeVisible();
    await allowedContext.close();
  }
});

test("security page shows own devices without token hashes", async ({ page }) => {
  await login(page, e2eUsers.normal.phone, e2eUsers.normal.password);
  await page.goto("/account/security");
  await expect(page.getByText("当前设备", { exact: true })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("tokenHash");
  await expect(page.getByRole("button", { name: "退出全部设备" })).toBeVisible();
});
