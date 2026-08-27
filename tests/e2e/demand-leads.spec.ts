import { expect, test, type Page } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { enterpriseE2e, e2eUsers, seedAuthFixtures } from "./auth-fixtures";

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

async function publicSubmit(page: Page, suffix: string) {
  await page.goto(`/public/demand?areaId=${enterpriseE2e.areaAId}`);
  await page.getByLabel("企业名称").fill(`E2E 公开企业 ${suffix}`);
  await page.getByLabel("联系人").fill("公开联系人");
  await page.getByLabel("联系电话").fill("13800005001");
  await page.getByLabel("需求标题").fill(`E2E 公开线索 ${suffix}`);
  await page.getByLabel("需求描述").fill("企业公开提交的原始内容，镇区核验不得覆盖。");
  await page.getByLabel("我确认以上信息真实。").check();
  await page.getByLabel("我同意镇区工作人员联系核实。").check();
  await page.waitForTimeout(900);
  const submitted = page.waitForResponse((response) => response.url().endsWith("/api/v2/public/demand-leads") && response.request().method() === "POST");
  await page.getByRole("button", { name: "提交需求线索" }).click();
  const response = await submitted;
  expect(response.status()).toBe(201);
  const payload = await response.json();
  expect(payload.data).toEqual({ referenceNo: expect.stringMatching(/^XS-\d{4}-\d{6}$/), message: "提交成功，镇区工作人员将与您联系。" });
  await expect(page.getByText(`参考编号 ${payload.data.referenceNo}`)).toBeVisible();
  return payload.data.referenceNo as string;
}

test.beforeEach(async () => { await seedAuthFixtures(); });

test("public submit is minimal and the responsible township sees the immutable source", async ({ page }) => {
  const suffix = Date.now().toString();
  const referenceNo = await publicSubmit(page, suffix);
  await page.context().clearCookies();
  await login(page, e2eUsers.township);
  await page.goto("/demands");
  await expect(page.getByRole("heading", { name: "待核验线索" })).toBeVisible();
  await page.getByRole("link", { name: new RegExp(`E2E 公开线索 ${suffix}`) }).click();
  await expect(page.getByText("原始提交 / 走访来源 · 永久快照")).toBeVisible();
  await expect(page.getByText("企业公开提交的原始内容，镇区核验不得覆盖。")).toBeVisible();
  await expect(page.getByText(referenceNo)).toBeVisible();
});

test("township links, supplements and converts a public lead to exactly one DRAFT", async ({ page }) => {
  const referenceNo = await publicSubmit(page, `convert-${Date.now()}`);
  const prisma = getPrismaClient();
  const lead = await prisma.demandLead.findUniqueOrThrow({ where: { businessNo: referenceNo } });
  await page.context().clearCookies();
  await login(page, e2eUsers.township);
  const result = await page.evaluate(async ({ leadId, enterpriseId, contactId }) => {
    const post = async (path: string, body: unknown) => {
      const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, payload: await response.json() };
    };
    const linked = await post(`/api/v2/demand-leads/${leadId}/link-enterprise`, { enterpriseId });
    const supplemented = await post(`/api/v2/demand-leads/${leadId}/add-info`, { action: "ADD_SUPPLEMENT", verifiedTitle: "人工核验标题", verifiedDescription: "镇区核验后的正式输入", demandType: "TECHNICAL", urgency: "NORMAL", selectedContactId: contactId });
    const converted = await post(`/api/v2/demand-leads/${leadId}/convert-to-draft`, { selectedContactId: contactId, title: "人工核验标题", originalDescription: "镇区核验后的正式输入", demandType: "TECHNICAL", urgency: "NORMAL", confirmation: "CONFIRM" });
    const repeated = await post(`/api/v2/demand-leads/${leadId}/convert-to-draft`, { selectedContactId: contactId, title: "人工核验标题", originalDescription: "镇区核验后的正式输入", demandType: "TECHNICAL", urgency: "NORMAL", confirmation: "CONFIRM" });
    return { linked, supplemented, converted, repeated };
  }, { leadId: lead.id, enterpriseId: enterpriseE2e.enterpriseId, contactId: enterpriseE2e.contactId });
  expect(result.linked.status).toBe(200);
  expect(result.supplemented.status).toBe(200);
  expect(result.converted.status).toBe(200);
  expect(result.repeated.status).toBe(200);
  expect(result.converted.payload.data.id).toBe(result.repeated.payload.data.id);
  expect(await prisma.demand.count({ where: { provenances: { some: { demandLeadId: lead.id } } } })).toBe(1);
  expect(await prisma.demandLead.findUniqueOrThrow({ where: { id: lead.id } })).toMatchObject({ status: "CONVERTED", rawContent: "企业公开提交的原始内容，镇区核验不得覆盖。" });
  expect(await prisma.demandContactSnapshot.count({ where: { demand: { provenances: { some: { demandLeadId: lead.id } } } } })).toBe(1);
});

test("admin merges, closes and restores from detail-confirmation endpoints", async ({ page }) => {
  await login(page, e2eUsers.admin);
  const ids = await page.evaluate(async (areaId) => {
    const create = async (suffix: string) => {
      const response = await fetch("/api/v2/demand-leads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ responsibleAreaId: areaId, rawEnterpriseName: `E2E 管理线索企业 ${suffix}`, rawTitle: `管理线索 ${suffix}`, rawContent: "管理员测试原文", sourceChannel: "E2E_ADMIN", attachmentIds: [] }) });
      return (await response.json()).data.id as string;
    };
    return { source: await create("source"), target: await create("target"), closed: await create("closed") };
  }, enterpriseE2e.areaAId);
  const statuses = await page.evaluate(async (input) => {
    const post = async (path: string, body: unknown) => (await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).status;
    return {
      merged: await post(`/api/v2/demand-leads/${input.source}/merge`, { targetLeadId: input.target, reason: "E2E 重复", confirmation: "CONFIRM" }),
      closed: await post(`/api/v2/demand-leads/${input.closed}/close`, { reason: "E2E 误关闭" }),
      restored: await post(`/api/v2/demand-leads/${input.closed}/restore`, { reason: "E2E 恢复", confirmation: "CONFIRM" }),
    };
  }, ids);
  expect(statuses).toEqual({ merged: 200, closed: 200, restored: 200 });
  await page.goto(`/admin/demand-leads/${ids.source}`);
  await expect(page.getByText("该线索已进入终态，原始来源和附件保持只读。")).toBeVisible();
  await expect(page.getByText(/已合并/)).toBeVisible();
});

test("unauthorized member cannot discover pre-publish leads through page or API", async ({ page }) => {
  const referenceNo = await publicSubmit(page, `forbidden-${Date.now()}`);
  const lead = await getPrismaClient().demandLead.findUniqueOrThrow({ where: { businessNo: referenceNo } });
  await page.context().clearCookies();
  await login(page, e2eUsers.normal);
  const status = await page.evaluate(async (leadId) => (await fetch(`/api/v2/demand-leads/${leadId}`)).status, lead.id);
  expect(status).toBe(403);
  await page.goto(`/demand-leads/${lead.id}`);
  await expect(page.getByRole("heading", { name: "不能查看发布前需求线索" })).toBeVisible();
  await page.goto("/demands");
  await expect(page.getByText("未获线索权限的账号不会看到发布前线索。")).toBeVisible();
});
