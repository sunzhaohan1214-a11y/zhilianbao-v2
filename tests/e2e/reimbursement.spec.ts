import { expect, test, type Page } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { e2eUsers, seedAuthFixtures } from "./auth-fixtures";

test.setTimeout(120_000);
async function login(page: Page, user: { phone: string; password: string }) { await page.goto("/login"); await page.getByLabel("手机号").fill(user.phone); await page.getByLabel("密码", { exact: true }).fill(user.password); await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/v2/auth/login")), page.getByRole("button", { name: "登录" }).click()]); }
async function api(page: Page, url: string, body?: unknown, headers?: Record<string, string>, method?: string) { return page.evaluate(async ({ url, body, headers, method }) => { const response = await fetch(url, { method: method ?? (body === undefined ? "GET" : "POST"), headers: body === undefined ? headers : { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, json: await response.json() }; }, { url, body, headers, method }); }
const body = (reason = "E2E 出行报销") => ({ type: "TRAVEL", reason, linkedTripId: null, expenses: [{ expenseType: "TRAVEL_TRANSPORT_ACTUAL", amount: "188.50", source: "MANUAL" }, { expenseType: "TRAVEL_MEAL_SUBSIDY", amount: "200", source: "MANUAL", referenceRate: "100", claimedDays: "2" }] });
async function create(page: Page, reason?: string) { return api(page, "/api/v2/reimbursements", body(reason)); }
test.beforeEach(async () => { await seedAuthFixtures(); });

test("01 current member sees the mobile reimbursement entrance and creates a BX draft", async ({ page }) => {
  await login(page, e2eUsers.normal); await page.goto("/me"); await expect(page.getByRole("link", { name: /报销/ })).toBeVisible();
  const result = await create(page); expect(result.status).toBe(201); expect(result.json.data).toMatchObject({ type: "TRAVEL", status: "DRAFT", applicantPersonId: e2eUsers.normal.personId }); expect(result.json.data.businessNo).toMatch(/^BX-\d{4}-\d{6}$/);
});

test("02 unrelated current member, MINISTER and ADMIN receive privacy-preserving not found", async ({ page }) => {
  await login(page, e2eUsers.normal); const item = await create(page, "私密报销");
  for (const user of [e2eUsers.groupLeader, e2eUsers.minister, e2eUsers.admin]) { await page.context().clearCookies(); await login(page, user); expect((await api(page, `/api/v2/reimbursements/${item.json.data.id}`)).status).toBe(404); }
});

test("03 submit requires Idempotency-Key and replay creates one immutable version", async ({ page }) => {
  await login(page, e2eUsers.normal); const item = await create(page); const url = `/api/v2/reimbursements/${item.json.data.id}/submit`;
  expect((await api(page, url, {})).status).toBe(400); const key = crypto.randomUUID(); const first = await api(page, url, {}, { "Idempotency-Key": key }); const replay = await api(page, url, {}, { "Idempotency-Key": key });
  expect(first.status).toBe(200); expect(replay.status).toBe(200); expect(replay.json.data).toEqual(first.json.data);
  const detail = await api(page, `/api/v2/reimbursements/${item.json.data.id}`); expect(detail.json.data.submissionVersions).toHaveLength(1);
});

test("04 SUPER manager follows material-check and paper-flow states without approval semantics", async ({ page }) => {
  await login(page, e2eUsers.normal); const item = await create(page); await api(page, `/api/v2/reimbursements/${item.json.data.id}/submit`, {}, { "Idempotency-Key": crypto.randomUUID() });
  await page.context().clearCookies(); await login(page, e2eUsers.superAdmin);
  let result = await api(page, `/api/v2/reimbursement-admin/${item.json.data.id}/verify`, {}); expect(result.json.data.status).toBe("VERIFIED_PENDING_PAPER");
  result = await api(page, `/api/v2/reimbursement-admin/${item.json.data.id}/paper-received`, {}); expect(result.json.data.status).toBe("PAPER_RECEIVED");
  result = await api(page, `/api/v2/reimbursement-admin/${item.json.data.id}/finance-submitted`, {}); expect(result.json.data.status).toBe("FINANCE_SUBMITTED");
});

test("05 ordinary ADMIN has neither management list nor independent manager shell", async ({ page }) => {
  await login(page, e2eUsers.admin); expect((await api(page, "/api/v2/reimbursement-admin")).status).toBe(403); const response = await page.goto("/reimbursement-admin"); expect(response?.status()).toBe(404);
});

test("06 reimbursement manager shell is independent from the ordinary admin shell", async ({ page }) => {
  await login(page, e2eUsers.superAdmin); await page.goto("/reimbursement-admin"); await expect(page.getByRole("heading", { name: "报销管理" })).toBeVisible(); await expect(page.getByText("报销材料流转")).toBeVisible(); await expect(page.locator('a[href^="/admin/"]')).toHaveCount(0);
});

test("07 activity reimbursement keeps flexible details and requires an OTHER name", async ({ page }) => {
  await login(page, e2eUsers.normal); const invalid = await api(page, "/api/v2/reimbursements", { type: "ACTIVITY", reason: "人才活动", expenses: [{ expenseType: "OTHER", amount: "10", source: "MANUAL" }] }); expect(invalid.status).toBe(422);
  const valid = await api(page, "/api/v2/reimbursements", { type: "ACTIVITY", reason: "人才活动", expenses: [
    { expenseType: "DINING", amount: "100", source: "MANUAL" }, { expenseType: "VENUE", amount: "200", source: "MANUAL" },
    { expenseType: "MATERIAL_PRODUCTION", amount: "300", source: "MANUAL" }, { expenseType: "OTHER", customExpenseName: "志愿者保险", amount: "50", source: "MANUAL" },
  ] }); expect(valid.status).toBe(201); expect(Number(valid.json.data.totalAmount)).toBe(650);
  const submitted = await api(page, `/api/v2/reimbursements/${valid.json.data.id}/submit`, {}, { "Idempotency-Key": crypto.randomUUID() }); expect(submitted.status).toBe(200); expect(Number(submitted.json.data.totalAmount)).toBe(650);
});

test("08 withdraw, return, resubmit and paper-incomplete retain submission history", async ({ page }) => {
  await login(page, e2eUsers.normal); const item = await create(page, "版本流转"); const id = item.json.data.id;
  await api(page, `/api/v2/reimbursements/${id}/submit`, {}, { "Idempotency-Key": crypto.randomUUID() }); expect((await api(page, `/api/v2/reimbursements/${id}/withdraw`, {})).json.data.status).toBe("DRAFT");
  await api(page, `/api/v2/reimbursements/${id}/submit`, {}, { "Idempotency-Key": crypto.randomUUID() }); await page.context().clearCookies(); await login(page, e2eUsers.superAdmin);
  expect((await api(page, `/api/v2/reimbursement-admin/${id}/return`, { reason: "补充材料" })).json.data.status).toBe("RETURNED");
  await page.context().clearCookies(); await login(page, e2eUsers.normal); await api(page, `/api/v2/reimbursements/${id}/update`, body("补充后的版本")); await api(page, `/api/v2/reimbursements/${id}/submit`, {}, { "Idempotency-Key": crypto.randomUUID() });
  const detail = await api(page, `/api/v2/reimbursements/${id}`); expect(detail.json.data.submissionVersions).toHaveLength(3); expect(detail.json.data.timeline.map((x: { actionCode: string }) => x.actionCode)).toEqual(expect.arrayContaining(["REIMBURSEMENT_WITHDRAWN", "REIMBURSEMENT_RETURNED"]));
  await page.context().clearCookies(); await login(page, e2eUsers.superAdmin); await api(page, `/api/v2/reimbursement-admin/${id}/verify`, {}); await api(page, `/api/v2/reimbursement-admin/${id}/paper-received`, {}); expect((await api(page, `/api/v2/reimbursement-admin/${id}/paper-incomplete`, { reason: "缺签字" })).json.data.status).toBe("VERIFIED_PENDING_PAPER");
});

test("09 taxi and dining OCR warnings cannot become travel actual, and subsidies cannot be OCR-sourced", async ({ page }) => {
  await login(page, e2eUsers.normal); const item = await create(page, "OCR 负例"); const prisma = getPrismaClient();
  for (const [index, warning] of ["出租车/网约车票据不得计入出行交通费实报实销", "餐饮票据不能作为出行报销费用"].entries()) {
    const attachment = await prisma.attachment.create({ data: { originalFilename: `negative-${index}.pdf`, extension: "pdf", declaredMimeType: "application/pdf", expectedSizeBytes: BigInt(8), actualSizeBytes: BigInt(8), bucket: "test", region: "test", objectKey: `negative/${crypto.randomUUID()}.pdf`, uploadStatus: "UPLOADED", scanStatus: "PASSED", isTemporary: false, uploadedByPersonId: e2eUsers.normal.personId } });
    const invoice = await prisma.reimbursementInvoice.create({ data: { reimbursementId: item.json.data.id, attachmentId: attachment.id, ocrStatus: "READY", ocrWarning: warning } });
    const result = await api(page, `/api/v2/reimbursement-invoices/${invoice.id}/confirm`, { expenseType: "TRAVEL_TRANSPORT_ACTUAL", amount: "20" }); expect(result.status).toBe(422);
  }
  const subsidy = await api(page, `/api/v2/reimbursements/${item.json.data.id}/update`, { type: "TRAVEL", reason: "OCR 负例", expenses: [{ expenseType: "TRAVEL_MEAL_SUBSIDY", amount: "100", source: "OCR", referenceRate: "100", claimedDays: "1" }] }); expect(subsidy.status).toBe(422);
});

test("10 export requires reimbursement manager permission and password reauthentication", async ({ page }) => {
  await login(page, e2eUsers.normal); const item = await create(page, "导出权限"); await api(page, `/api/v2/reimbursements/${item.json.data.id}/submit`, {}, { "Idempotency-Key": crypto.randomUUID() });
  expect((await api(page, "/api/v2/reimbursement-admin/export", { reimbursementIds: [item.json.data.id], format: "PDF", reauthPassword: e2eUsers.normal.password })).status).toBe(403);
  await page.context().clearCookies(); await login(page, e2eUsers.admin); expect((await api(page, "/api/v2/reimbursement-admin/export", { reimbursementIds: [item.json.data.id], format: "PDF", reauthPassword: e2eUsers.admin.password })).status).toBe(403);
  await page.context().clearCookies(); await login(page, e2eUsers.superAdmin); expect((await api(page, "/api/v2/reimbursement-admin/export", { reimbursementIds: [item.json.data.id], format: "PDF", reauthPassword: "wrong-password" })).status).toBe(403);
  const task = await api(page, "/api/v2/reimbursement-admin/export", { reimbursementIds: [item.json.data.id], format: "PDF", reauthPassword: e2eUsers.superAdmin.password }); expect(task.status).toBe(202); expect(task.json.data).toMatchObject({ format: "PDF", status: "WAITING", createdByPersonId: e2eUsers.superAdmin.personId });
});

test("11 ADMIN grants and revokes alumni apply without gaining content visibility", async ({ page }) => {
  await login(page, e2eUsers.admin); const enabled = await api(page, `/api/v2/admin/people/${e2eUsers.alumni.personId}/reimbursement-apply/enable`, { reason: "专项往届报销" }); expect(enabled.status).toBe(201);
  await page.context().clearCookies(); await login(page, e2eUsers.alumni); const created = await create(page, "往届专项报销"); expect(created.status).toBe(201);
  await page.context().clearCookies(); await login(page, e2eUsers.admin); expect((await api(page, `/api/v2/reimbursements/${created.json.data.id}`)).status).toBe(404);
  expect((await api(page, `/api/v2/admin/people/${e2eUsers.alumni.personId}/reimbursement-apply/disable`, { reason: "专项结束" })).status).toBe(200);
  await page.context().clearCookies(); await login(page, e2eUsers.alumni); expect((await create(page, "撤权后不得新建")).status).toBe(403); expect((await api(page, `/api/v2/reimbursements/${created.json.data.id}`)).status).toBe(200);
});
