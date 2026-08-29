import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { e2eUsers, enterpriseE2e } from "./auth-fixtures";

let demandId = "";

async function login(page: Page, user: { phone: string; password: string }) {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "登录智链宝" })).toBeVisible();
  await page.getByLabel("手机号").fill(user.phone);
  await page.getByLabel("密码", { exact: true }).fill(user.password);
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/v2/auth/login")),
    page.getByRole("button", { name: "登录" }).click(),
  ]);
  await expect(page).not.toHaveURL(/\/login$/);
}

test.beforeAll(async () => {
  const prisma = getPrismaClient();
  const created = await prisma.demand.create({ data: {
    businessNo: `XQ2026${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    enterpriseId: enterpriseE2e.enterpriseId, responsibleAreaId: enterpriseE2e.areaAId,
    selectedContactId: enterpriseE2e.contactId, title: `M3-008 浏览器兼容 ${randomUUID()}`,
    originalDescription: "Chrome Firefox Safari mobile compatibility fixture", demandType: "TECHNICAL", urgency: "NORMAL",
    status: "PENDING_CLAIM", creationBatchId: enterpriseE2e.batchId, currentFollowBatchId: enterpriseE2e.batchId,
    firstPublishedAt: new Date(), createdByPersonId: e2eUsers.admin.personId,
  } });
  demandId = created.id;
  await prisma.$disconnect();
});

test.afterAll(async () => {
  const prisma = getPrismaClient();
  if (demandId) await prisma.demand.deleteMany({ where: { id: demandId } });
  await prisma.$disconnect();
});

test("@compat login, home, demand, attachment, report and system basics render without server errors", async ({ page }) => {
  await login(page, e2eUsers.normal);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "首页" })).toBeVisible();

  const demand = await page.goto(`/demands/${demandId}`);
  expect(demand?.status()).toBeLessThan(500);
  await expect(page.getByText(/M3-008 浏览器兼容/)).toBeVisible();

  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n");
  const mutationHeaders = { origin: new URL(page.url()).origin };
  const intent = await page.request.post("/api/v2/attachments/upload-intent", {
    headers: mutationHeaders,
    data: { filename: "browser-compat.pdf", declaredMimeType: "application/pdf", expectedSizeBytes: pdf.byteLength },
  });
  expect(intent.status()).toBe(201);
  const attachmentId = (await intent.json()).data.attachmentId as string;
  expect((await page.request.post(`/api/v2/test/attachments/${attachmentId}/upload`, {
    headers: mutationHeaders,
    data: { base64: pdf.toString("base64") },
  })).status()).toBe(200);
  expect((await page.request.post(`/api/v2/attachments/${attachmentId}/complete`, { headers: mutationHeaders })).status()).toBe(200);
  expect((await page.request.post(`/api/v2/test/attachments/${attachmentId}/scan`, { headers: mutationHeaders })).status()).toBe(200);
  expect((await page.request.get(`/api/v2/attachments/${attachmentId}/access?action=preview`)).status()).toBe(200);
  expect((await page.request.post(`/api/v2/attachments/${attachmentId}/abort`, { headers: mutationHeaders })).status()).toBe(200);

  await page.context().clearCookies();
  await login(page, e2eUsers.admin);
  const report = await page.goto("/reports/monthly");
  expect(report?.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { name: "月度工作台账" })).toBeVisible();

  await page.context().clearCookies();
  await login(page, e2eUsers.superAdmin);
  const system = await page.goto("/admin/system");
  expect(system?.status()).toBeLessThan(500);
  await expect(page.getByRole("heading", { name: "系统治理" })).toBeVisible();
});

test("@compat Shanghai business month is stable in UTC and America/Los_Angeles browser timezones", async ({ browser }) => {
  const values: string[] = [];
  for (const timezoneId of ["UTC", "America/Los_Angeles"]) {
    const context = await browser.newContext({ timezoneId });
    const page = await context.newPage();
    await login(page, e2eUsers.admin);
    await page.goto("/reports/monthly");
    values.push(await page.getByLabel("月份").inputValue());
    await context.close();
  }
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const expected = `${parts.find(({ type }) => type === "year")?.value}-${parts.find(({ type }) => type === "month")?.value}`;
  expect(values).toEqual([expected, expected]);
});
