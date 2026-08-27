import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { enterpriseE2e, e2eUsers, seedAuthFixtures } from "./auth-fixtures";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

async function login(page: Page, user: { phone: string; password: string }) {
  await page.context().clearCookies();
  const response = await page.request.post("/api/v2/auth/login", {
    headers: { origin: "http://127.0.0.1:3000" },
    data: { phone: user.phone, password: user.password },
  });
  expect(response.status()).toBe(200);
}

async function post(page: Page, path: string, body: unknown, headers: Record<string, string> = {}) {
  return page.evaluate(async ({ path, body, headers }) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    return { status: response.status, payload: await response.json() };
  }, { path, body, headers });
}

function demandPayload(title: string, attachmentIds: string[] = []) {
  return {
    enterpriseId: enterpriseE2e.enterpriseId,
    selectedContactId: enterpriseE2e.contactId,
    title,
    originalDescription: "E2E 企业原始需求描述，由镇区录入并提交管理员审核。",
    demandType: "TECHNICAL",
    urgency: "NORMAL",
    responsibleAreaId: enterpriseE2e.areaAId,
    internalNote: "E2E 内部说明",
    attachmentIds,
  };
}

test.beforeEach(async () => { await seedAuthFixtures(); });

test("formal demand return/resubmit/approve and ADMIN_DIRECT publish preserve every M1-003 boundary", async ({ page }) => {
  const prisma = getPrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const attachmentName = `formal-e2e-${suffix}.pdf`;
  const passedAttachment = await prisma.attachment.create({ data: {
    originalFilename: attachmentName,
    extension: "pdf",
    declaredMimeType: "application/pdf",
    expectedSizeBytes: BigInt(18),
    actualSizeBytes: BigInt(18),
    bucket: "test-private-bucket",
    region: "ap-test",
    objectKey: `formal-e2e/${randomUUID()}.pdf`,
    uploadStatus: "UPLOADED",
    scanStatus: "PASSED",
    isTemporary: true,
    uploadedByPersonId: e2eUsers.township.personId,
  } });

  await login(page, e2eUsers.township);
  const created = await post(page, "/api/v2/demands", demandPayload(`E2E 镇区正式需求 ${suffix}`, [passedAttachment.id]));
  expect(created.status).toBe(201);
  const demandId = created.payload.data.id as string;
  const unpublished = await post(page, "/api/v2/demands", demandPayload(`E2E 发布前不可见 ${suffix}`));
  expect(unpublished.status).toBe(201);
  const unpublishedId = unpublished.payload.data.id as string;
  expect(created.payload.data.provenances).toEqual([expect.objectContaining({ sourceType: "TOWNSHIP_DIRECT" })]);

  await page.goto(`/demands/${demandId}`);
  await page.getByLabel("标题", { exact: true }).fill(`E2E 已修改核心标题 ${suffix}`);
  await page.getByRole("button", { name: "保存草稿修改" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  await page.getByRole("button", { name: "提交审核" }).click();
  await expect(page.getByText("待审核", { exact: true })).toBeVisible();

  await login(page, e2eUsers.admin);
  await page.goto(`/admin/demands/${demandId}`);
  await expect(page.getByRole("heading", { name: "管理员审核" })).toBeVisible();
  await expect(page.getByLabel("标题", { exact: true })).toHaveCount(0);
  const coreMassAssignment = await post(page, `/api/v2/demands/${demandId}/review`, { decision: "APPROVE", title: "审核员越权修改核心" });
  expect(coreMassAssignment.status).toBe(400);
  await page.getByPlaceholder("退回原因（退回时必填）").fill("请补充量化目标和实施边界");
  await page.getByRole("button", { name: "退回修改" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  await expect(page.getByText("退回修改", { exact: true }).first()).toBeVisible();

  await login(page, e2eUsers.township);
  await page.goto(`/demands/${demandId}`);
  await expect(page.getByText("请补充量化目标和实施边界").first()).toBeVisible();
  await page.getByLabel("企业原始需求描述", { exact: true }).fill("E2E 退回后补充量化目标，但仍由原录入方修改核心字段。");
  await page.getByRole("button", { name: "保存草稿修改" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  await page.getByRole("button", { name: "提交审核" }).click();
  await expect(page.getByText("待审核", { exact: true })).toBeVisible();

  await login(page, e2eUsers.admin);
  await page.goto(`/admin/demands/${demandId}`);
  await page.getByLabel("类型", { exact: true }).selectOption("TALENT");
  await page.getByLabel("紧急程度", { exact: true }).selectOption("URGENT");
  await page.getByRole("button", { name: "审核通过并立即发布" }).click();
  await expect(page.getByText("待对接", { exact: true })).toBeVisible();

  const adminDraft = await post(page, "/api/v2/demands", demandPayload(`E2E 管理员代录 ${suffix}`));
  expect(adminDraft.status).toBe(201);
  expect(adminDraft.payload.data.provenances).toEqual([expect.objectContaining({ sourceType: "ADMIN_DIRECT" })]);
  const adminDraftId = adminDraft.payload.data.id as string;

  await login(page, e2eUsers.township);
  expect((await post(page, `/api/v2/demands/${adminDraftId}/direct-publish`, {})).status).toBe(403);
  await login(page, e2eUsers.normal);
  expect((await post(page, `/api/v2/demands/${adminDraftId}/direct-publish`, {})).status).toBe(403);
  const visibility = await page.evaluate(async ({ demandId, unpublishedId }) => ({
    published: (await fetch(`/api/v2/demands/${demandId}`)).status,
    unpublished: (await fetch(`/api/v2/demands/${unpublishedId}`)).status,
  }), { demandId, unpublishedId });
  expect(visibility).toEqual({ published: 200, unpublished: 404 });
  await page.goto("/demands");
  await page.getByRole("link", { name: new RegExp(`E2E 已修改核心标题 ${suffix}`) }).click();
  await expect(page.getByText("13800003001")).toBeVisible();
  await expect(page.getByText(attachmentName)).toBeVisible();
  await expect(page.getByText(/认领|协作|进展录入|办理进度/)).toHaveCount(0);

  await login(page, e2eUsers.admin);
  const directPublished = await post(page, `/api/v2/demands/${adminDraftId}/direct-publish`, {});
  expect(directPublished.status).toBe(200);
  expect(directPublished.payload.data).toMatchObject({ status: "PENDING_CLAIM", firstPublishedAt: expect.any(String) });
  await page.goto(`/admin/demands/${adminDraftId}`);
  await expect(page.getByText("待对接", { exact: true })).toBeVisible();
});
