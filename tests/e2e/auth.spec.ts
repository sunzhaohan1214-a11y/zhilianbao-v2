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
    await expect(allowed.getByRole("heading", { name: "业务处理入口" })).toBeVisible();
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

test("attachment API enforces scan gate, self access, short URL and abort", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await login(owner, e2eUsers.normal.phone, e2eUsers.normal.password);
  const pdf = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n";
  const intent = await owner.evaluate(async ({ expectedSizeBytes }) => {
    const response = await fetch("/api/v2/attachments/upload-intent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ filename: "e2e-report.pdf", declaredMimeType: "application/pdf", expectedSizeBytes }),
    });
    return { status: response.status, body: await response.json() };
  }, { expectedSizeBytes: Buffer.byteLength(pdf) });
  expect(intent.status).toBe(201);
  const attachmentId = intent.body.data.attachmentId as string;
  expect(intent.body.data.upload.type).toBe("TEST_MEMORY");

  const uploadStatus = await owner.evaluate(async ({ id, base64 }) => {
    const response = await fetch(`/api/v2/test/attachments/${id}/upload`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ base64 }),
    });
    return response.status;
  }, { id: attachmentId, base64: Buffer.from(pdf).toString("base64") });
  expect(uploadStatus).toBe(200);

  const completeStatus = await owner.evaluate(async (id) => (await fetch(`/api/v2/attachments/${id}/complete`, { method: "POST" })).status, attachmentId);
  expect(completeStatus).toBe(200);
  const pendingAccess = await owner.evaluate(async (id) => (await fetch(`/api/v2/attachments/${id}/access?action=preview`)).status, attachmentId);
  expect(pendingAccess).toBe(409);
  const scanStatus = await owner.evaluate(async (id) => (await fetch(`/api/v2/test/attachments/${id}/scan`, { method: "POST" })).status, attachmentId);
  expect(scanStatus).toBe(200);
  const access = await owner.evaluate(async (id) => {
    const response = await fetch(`/api/v2/attachments/${id}/access?action=download`);
    return { status: response.status, body: await response.json() };
  }, attachmentId);
  expect(access.status).toBe(200);
  expect(access.body.data.ttlSeconds).toBe(300);

  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await login(other, e2eUsers.minister.phone, e2eUsers.minister.password);
  const otherAccess = await other.evaluate(async (id) => (await fetch(`/api/v2/attachments/${id}/access?action=download`)).status, attachmentId);
  expect(otherAccess).toBe(403);
  await otherContext.close();

  const abortStatus = await owner.evaluate(async (id) => (await fetch(`/api/v2/attachments/${id}/abort`, { method: "POST" })).status, attachmentId);
  expect(abortStatus).toBe(200);
  await ownerContext.close();
});
