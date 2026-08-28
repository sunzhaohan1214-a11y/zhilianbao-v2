import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { expect, test, type Page } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { e2eUsers, enterpriseE2e, seedAuthFixtures } from "./auth-fixtures";

test.describe.configure({ mode: "serial" });

async function login(page: Page, user: { phone: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("手机号").fill(user.phone);
  await page.getByLabel("密码", { exact: true }).fill(user.password);
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith("/api/v2/auth/login")),
    page.getByRole("button", { name: "登录" }).click(),
  ]);
}

async function enterpriseWorkbook() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("企业导入");
  sheet.addRow(["企业名称", "信用代码", "镇区", "地址", "主营产品"]);
  sheet.addRow(["宝应智造示范企业", "91321023E2ETEST001", "安宜镇", "宝应县安宜镇测试大道1号", "智能装备、工业软件与技术服务"]);
  sheet.addRow(["E2E 导入新企业", "91321023E2EIMP0001", "安宜镇", "宝应县安宜镇导入路1号", "绿色装备"]);
  sheet.addRow(["宝应智造示范企业", "", "安宜镇", "宝应县安宜镇测试大道1号", "智能装备、工业软件与技术服务"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function memberWorkbook(newPhone: string, historicalPhone: string, reviewPhone: string) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("团员导入");
  sheet.addRow(["姓名", "手机号", "批次", "成员类型", "开始日期", "创建账号"]);
  sheet.addRow(["E2E normal", e2eUsers.normal.phone, "E2E current batch", "在任", "2026-01-01", "是"]);
  sheet.addRow(["E2E 导入在任成员", newPhone, "E2E current batch", "在任", "2026-01-01", "是"]);
  sheet.addRow(["E2E 导入历史往届", historicalPhone, "E2E historical batch", "历史往届", "2025-01-01", "否"]);
  sheet.addRow(["E2E normal", reviewPhone, "E2E current batch", "在任", "2026-01-01", "否"]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function uploadResolveAndConfirm(page: Page, buffer: Buffer) {
  await page.goto("/admin/imports/new");
  await page.getByLabel("Excel 文件").setInputFiles({
    name: "enterprise-import.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.getByRole("button", { name: "上传并创建预览" }).click();
  await page.waitForURL(/\/admin\/imports\/[0-9a-f-]+$/);
  await expect(page.getByText("PREVIEW_READY", { exact: true })).toBeVisible();
  await expect(page.getByText("安宜镇 · 信用代码：9132…T001 · 状态：正常")).toBeVisible();
  await expect(page.getByRole("button", { name: new RegExp(enterpriseE2e.enterpriseId.slice(0, 8)) })).toHaveCount(0);
  const resolution = page.waitForResponse((response) => response.url().includes("/resolve") && response.request().method() === "POST");
  await page.getByRole("button", { name: "选择 宝应智造示范企业" }).click();
  expect((await resolution).status()).toBe(200);
  await expect(page.getByRole("button", { name: "确认导入" })).toBeEnabled();
  await page.getByRole("button", { name: "确认导入" }).click();
  const dialog = page.getByRole("dialog", { name: "确认执行正式导入" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Preview Version/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "确认执行导入" })).toBeDisabled();
  const batchId = page.url().split("/").at(-1)!;
  expect(await getPrismaClient().importBatch.findUniqueOrThrow({ where: { id: batchId }, select: { status: true } })).toEqual({ status: "PREVIEW_READY" });
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(dialog).toBeHidden();
  expect(await getPrismaClient().importBatch.findUniqueOrThrow({ where: { id: batchId }, select: { status: true } })).toEqual({ status: "PREVIEW_READY" });
  await page.getByRole("button", { name: "确认导入" }).click();
  await page.getByLabel("我已核对预览结果与正式候选").check();
  const confirmation = page.waitForResponse((response) => response.url().endsWith("/confirm") && response.request().method() === "POST");
  await page.getByRole("button", { name: "确认执行导入" }).click();
  expect((await confirmation).status()).toBe(200);
  await expect(page.getByText("SUCCEEDED", { exact: true })).toBeVisible();
}

async function uploadMemberResolveAndConfirm(page: Page, buffer: Buffer) {
  await page.goto("/admin/imports/new");
  await page.getByLabel("导入类型").selectOption("MEMBER");
  await page.getByLabel("Excel 文件").setInputFiles({
    name: "member-import.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.getByRole("button", { name: "上传并创建预览" }).click();
  await page.waitForURL(/\/admin\/imports\/[0-9a-f-]+$/);
  await expect(page.getByText("PREVIEW_READY", { exact: true })).toBeVisible();
  const resolution = page.waitForResponse((response) => response.url().includes("/resolve") && response.request().method() === "POST");
  await page.getByRole("button", { name: "创建新记录" }).click();
  expect((await resolution).status()).toBe(200);
  await expect(page.getByRole("button", { name: "确认导入" })).toBeEnabled();
  await page.getByRole("button", { name: "确认导入" }).click();
  await page.getByLabel("我已核对预览结果与正式候选").check();
  const confirmation = page.waitForResponse((response) => response.url().endsWith("/confirm") && response.request().method() === "POST");
  await page.getByRole("button", { name: "确认执行导入" }).click();
  expect((await confirmation).status()).toBe(200);
  await expect(page.getByText("SUCCEEDED", { exact: true })).toBeVisible();
}

async function browserExport(page: Page, path: string) {
  return page.evaluate(async (exportPath) => {
    const response = await fetch(exportPath, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    return { status: response.status, bytes: Array.from(new Uint8Array(await response.arrayBuffer())) };
  }, path);
}

async function workbookNames(bytes: number[]) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as never);
  const names: string[] = [];
  workbook.worksheets[0].eachRow((row, rowNumber) => {
    if (rowNumber > 1) names.push(String(row.getCell(1).value ?? ""));
  });
  return names;
}

test.beforeEach(async () => { await seedAuthFixtures(); });

test("admin completes preview, manual resolution, atomic apply, and idempotent re-import", async ({ page }) => {
  await login(page, e2eUsers.admin);
  const buffer = await enterpriseWorkbook();
  await uploadResolveAndConfirm(page, buffer);
  await uploadResolveAndConfirm(page, buffer);

  const prisma = getPrismaClient();
  expect(await prisma.enterprise.count({ where: { creditCode: "91321023E2EIMP0001" } })).toBe(1);
  expect(await prisma.importBatch.count({ where: { createdByPersonId: e2eUsers.admin.personId, status: "SUCCEEDED" } })).toBe(2);
  await page.goto("/admin/enterprises?keyword=E2E%20导入新企业");
  await expect(page.getByRole("link", { name: "E2E 导入新企业" })).toBeVisible();

  const latestBatch = await prisma.importBatch.findFirstOrThrow({
    where: { createdByPersonId: e2eUsers.admin.personId },
    orderBy: { createdAt: "desc" },
    select: { id: true, sourceAttachmentId: true },
  });
  for (const user of [e2eUsers.normal, e2eUsers.township, e2eUsers.department]) {
    await page.context().clearCookies();
    await login(page, user);
    const guessed = await page.evaluate(async (batchId) => (await fetch(`/api/v2/admin/imports/${batchId}`)).status, latestBatch.id);
    expect([403, 404]).toContain(guessed);
    const createStatus = await page.evaluate(async (sourceAttachmentId) => (await fetch("/api/v2/admin/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ importType: "ENTERPRISE", sourceAttachmentId }),
    })).status, latestBatch.sourceAttachmentId);
    expect(createStatus).toBe(403);
  }

  await page.context().clearCookies();
  await login(page, e2eUsers.admin);
  await prisma.account.update({ where: { id: e2eUsers.admin.accountId }, data: { status: "DISABLED" } });
  try {
    const sourceStatus = await page.evaluate(async (attachmentId) => (await fetch(`/api/v2/attachments/${attachmentId}/access?action=download`)).status, latestBatch.sourceAttachmentId);
    expect([401, 403, 404]).toContain(sourceStatus);
  } finally {
    await prisma.account.update({ where: { id: e2eUsers.admin.accountId }, data: { status: "NORMAL" } });
  }
});

test("enterprise exports honor township and department scope while talent export stays admin-only", async ({ page }) => {
  const prisma = getPrismaClient();
  await prisma.enterprise.create({
    data: {
      name: `E2E 范围外企业-${randomUUID().slice(0, 8)}`,
      responsibleAreaId: enterpriseE2e.areaBId,
      address: "射阳湖镇测试路1号",
      mainProducts: "范围验证",
      createdByPersonId: e2eUsers.admin.personId,
    },
  });

  for (const user of [e2eUsers.township, e2eUsers.department]) {
    await page.context().clearCookies();
    await login(page, user);
    const exported = await browserExport(page, "/api/v2/enterprises/export");
    expect(exported.status).toBe(200);
    const names = await workbookNames(exported.bytes);
    expect(names).toContain("宝应智造示范企业");
    expect(names.some((name) => name.startsWith("E2E 范围外企业-"))).toBe(false);
  }

  await page.context().clearCookies();
  await login(page, e2eUsers.normal);
  expect((await browserExport(page, "/api/v2/enterprises/export")).status).toBe(403);

  await page.context().clearCookies();
  await login(page, e2eUsers.township);
  expect((await browserExport(page, "/api/v2/admin/talents/export")).status).toBe(403);

  await page.context().clearCookies();
  await login(page, e2eUsers.admin);
  const talent = await browserExport(page, "/api/v2/admin/talents/export");
  expect(talent.status).toBe(200);
  expect(await workbookNames(talent.bytes)).toContain("E2E 智能制造专家");
});

test("member import preserves an existing account and handles current, historical, and same-name review rows", async ({ page }) => {
  const prisma = getPrismaClient();
  const existing = await prisma.account.findUniqueOrThrow({ where: { id: e2eUsers.normal.accountId }, select: { passwordHash: true, status: true, forcePasswordChange: true } });
  const newPhone = "13900008201";
  const historicalPhone = "13900008202";
  const reviewPhone = "13900008203";

  await login(page, e2eUsers.admin);
  await uploadMemberResolveAndConfirm(page, await memberWorkbook(newPhone, historicalPhone, reviewPhone));

  expect(await prisma.account.findUniqueOrThrow({ where: { id: e2eUsers.normal.accountId }, select: { passwordHash: true, status: true, forcePasswordChange: true } })).toEqual(existing);
  const current = await prisma.person.findFirstOrThrow({ where: { contactPhone: newPhone }, include: { account: true, batchMemberships: true } });
  expect(current.account).toMatchObject({ phone: newPhone, status: "PENDING_ENABLE", forcePasswordChange: true });
  expect(current.batchMemberships).toEqual(expect.arrayContaining([expect.objectContaining({ batchId: enterpriseE2e.batchId, status: "ACTIVE" })]));
  const historical = await prisma.person.findFirstOrThrow({ where: { contactPhone: historicalPhone }, include: { account: true, batchMemberships: true } });
  expect(historical.account).toBeNull();
  expect(historical.batchMemberships).toEqual(expect.arrayContaining([expect.objectContaining({ batchId: enterpriseE2e.pastBatchId, status: "COMPLETED" })]));
  expect(await prisma.person.count({ where: { contactPhone: reviewPhone, name: "E2E normal" } })).toBe(1);
});
