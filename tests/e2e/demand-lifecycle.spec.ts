import { randomUUID } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { shanghaiDateString } from "@/modules/demand";
import { DEMAND_LIFECYCLE_NOTIFICATION_EVENTS, DemandProgressCloseNotificationHandler } from "@/modules/outbox/handlers/demand-progress-close-notification-handler";
import { OutboxHandlerRegistry } from "@/modules/outbox/outbox-handler-registry";
import { e2eUsers, enterpriseE2e, seedAuthFixtures } from "./auth-fixtures";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

async function login(browser: Browser, user: { phone: string; password: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.request.post("/api/v2/auth/login", {
    headers: { origin: "http://127.0.0.1:3000" },
    data: { phone: user.phone, password: user.password },
  });
  expect(response.status()).toBe(200);
  await page.goto("/");
  return { context, page };
}

async function createOwnerDemand(ownerPersonId = e2eUsers.normal.personId, titlePrefix = "E2E 生命周期", effectiveAt = new Date()) {
  const prisma = getPrismaClient();
  const demand = await prisma.demand.create({ data: {
    businessNo: `XQ2026${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    enterpriseId: enterpriseE2e.enterpriseId,
    responsibleAreaId: enterpriseE2e.areaAId,
    selectedContactId: enterpriseE2e.contactId,
    title: `${titlePrefix} ${randomUUID().slice(0, 8)}`,
    originalDescription: "验证需求进展、办结与责任生命周期。",
    demandType: "TECHNICAL",
    urgency: "NORMAL",
    status: "IN_PROGRESS",
    creationBatchId: enterpriseE2e.batchId,
    currentFollowBatchId: enterpriseE2e.batchId,
    currentOwnerPersonId: ownerPersonId,
    firstPublishedAt: effectiveAt,
    createdByPersonId: e2eUsers.admin.personId,
  } });
  await prisma.demandOwnerHistory.create({ data: {
    demandId: demand.id,
    personId: ownerPersonId,
    batchId: enterpriseE2e.batchId,
    effectiveAt,
    changeType: "CLAIM",
    createdByPersonId: ownerPersonId,
    activeKey: 1,
  } });
  return demand;
}

async function deliverLifecycleEvents(demandId: string) {
  const prisma = getPrismaClient();
  const registry = new OutboxHandlerRegistry();
  for (const eventType of DEMAND_LIFECYCLE_NOTIFICATION_EVENTS) registry.register(eventType, new DemandProgressCloseNotificationHandler(eventType));
  await prisma.$transaction(async (tx) => {
    const events = await tx.outboxEvent.findMany({ where: { aggregateId: demandId, publishedAt: null, eventType: { in: [...DEMAND_LIFECYCLE_NOTIFICATION_EVENTS] } }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }] });
    for (const event of events) {
      await registry.dispatch(event, tx);
      await tx.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date() } });
    }
  });
}

test.beforeEach(async () => { await seedAuthFixtures(); });

test("owner progress and close review are available in both mobile and admin detail", async ({ browser }) => {
  const prisma = getPrismaClient();
  const demand = await createOwnerDemand();

  let authenticated = await login(browser, e2eUsers.normal);
  let page = authenticated.page;
  await page.goto(`/demands/${demand.id}`);
  await expect(page.getByRole("heading", { name: "新增进展" })).toBeVisible();
  await page.locator('textarea[name="currentProgress"]').fill("已完成企业现场访谈");
  await page.locator('textarea[name="nextStep"]').fill("下周组织高校专家对接");
  await page.getByRole("button", { name: "提交进展" }).click();
  await expect(page.getByText("当前进展：已完成企业现场访谈")).toBeVisible();
  await page.locator('textarea[name="solution"]').fill("已形成技术诊断方案");
  await page.locator('textarea[name="connectedResources"]').fill("已对接高校专家团队");
  await page.getByRole("button", { name: "提交属地审核" }).click();
  await expect(page.getByText("待办结审核", { exact: true })).toBeVisible();
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  await page.goto(`/admin/demands/${demand.id}`);
  await expect(page.getByRole("heading", { name: "属地办结审核" })).toBeVisible();
  await page.locator('textarea[name="townshipVerificationResult"]').fill("已联系企业核验，需补充落地证明");
  await page.getByRole("textbox", { name: "退回原因" }).fill("请补充企业确认材料");
  await page.getByRole("button", { name: "退回继续跟进" }).click();
  await expect(page.getByText("对接中", { exact: true })).toBeVisible();
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.normal);
  page = authenticated.page;
  await page.goto(`/demands/${demand.id}`);
  await page.locator('textarea[name="currentProgress"]').fill("已补充企业确认材料");
  await page.locator('textarea[name="nextStep"]').fill("重新提交办结审核");
  await page.getByRole("button", { name: "提交进展" }).click();
  await page.locator('textarea[name="solution"]').fill("已形成技术诊断方案并取得企业确认");
  await page.locator('textarea[name="connectedResources"]').fill("已对接高校专家团队与实验室");
  await page.getByRole("button", { name: "提交属地审核" }).click();
  await expect(page.getByText("待办结审核", { exact: true })).toBeVisible();
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  await page.goto(`/admin/demands/${demand.id}`);
  await page.locator('textarea[name="townshipVerificationResult"]').fill("已联系企业核验，方案和资源均已落地");
  await page.getByLabel("不跟踪").check();
  await page.getByRole("button", { name: "确认办结并建立成效计划" }).click();
  await expect(page.getByText("需求已办结", { exact: true })).toBeVisible();
  await expect(page.getByText("已办结", { exact: true }).first()).toBeVisible();
  expect(await prisma.demandProgress.count({ where: { demandId: demand.id } })).toBe(2);
  expect(await prisma.demandCloseRequest.count({ where: { demandId: demand.id } })).toBe(2);
  expect(await prisma.demandCloseReview.count({ where: { demandId: demand.id } })).toBe(2);
  await authenticated.context.close();
});

test("owner exit review and SUPER transfer use the guarded responsibility workflow", async ({ browser }) => {
  const prisma = getPrismaClient();
  const exitDemand = await createOwnerDemand(e2eUsers.normal.personId, "E2E 主责退出");
  let authenticated = await login(browser, e2eUsers.normal);
  let page = authenticated.page;
  await page.goto(`/demands/${exitDemand.id}`);
  await page.locator("form").filter({ hasText: "申请退出主责" }).locator('textarea[name="reason"]').fill("岗位调整，申请退出主责");
  await page.getByRole("button", { name: "提交退出申请" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  expect(await prisma.demandOwnerExitRequest.count({ where: { demandId: exitDemand.id, status: "PENDING", activeKey: 1 } })).toBe(1);
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  await page.goto(`/admin/demands/${exitDemand.id}`);
  await page.locator('textarea[name="reviewReason"]').fill("当前事项即将完成，暂不同意退出");
  await page.getByRole("button", { name: "拒绝退出" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  expect(await prisma.demandOwnerExitRequest.count({ where: { demandId: exitDemand.id, status: "REJECTED", activeKey: null } })).toBe(1);
  expect(await prisma.demand.findUniqueOrThrow({ where: { id: exitDemand.id } })).toMatchObject({ status: "IN_PROGRESS", currentOwnerPersonId: e2eUsers.normal.personId });
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.normal);
  page = authenticated.page;
  await page.goto(`/demands/${exitDemand.id}`);
  await page.locator("form").filter({ hasText: "申请退出主责" }).locator('textarea[name="reason"]').fill("工作已正式交接，再次申请退出");
  await page.getByRole("button", { name: "提交退出申请" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  await page.goto(`/admin/demands/${exitDemand.id}`);
  await page.locator('textarea[name="reviewReason"]').fill("同意退出，需求重新开放认领");
  await page.getByRole("button", { name: "同意退出" }).click();
  await expect(page.getByText("待对接", { exact: true })).toBeVisible();
  expect(await prisma.demand.findUniqueOrThrow({ where: { id: exitDemand.id } })).toMatchObject({ status: "PENDING_CLAIM", currentOwnerPersonId: null });
  await authenticated.context.close();

  const transferDemand = await createOwnerDemand(e2eUsers.normal.personId, "E2E SUPER 转交");
  authenticated = await login(browser, e2eUsers.superAdmin);
  page = authenticated.page;
  await page.goto(`/admin/demands/${transferDemand.id}`);
  const transferForm = page.locator("form").filter({ hasText: "SUPER_ADMIN 强制转交主责" });
  await transferForm.locator('select[name="newOwnerPersonId"]').selectOption(e2eUsers.minister.personId);
  await transferForm.locator('textarea[name="reason"]').fill("调整专业分工，由新主责接管");
  await page.getByRole("button", { name: "生成影响预览" }).click();
  await expect(page.getByRole("heading", { name: "确认转交影响" })).toBeVisible();
  await expect(page.getByText(/E2E normal → E2E minister/)).toBeVisible();
  await page.getByRole("button", { name: "我已核对，确认强制转交" }).click();
  await expect(page.getByText("当前负责人：E2E minister", { exact: true })).toBeVisible();
  expect(await prisma.demand.findUniqueOrThrow({ where: { id: transferDemand.id } })).toMatchObject({ status: "IN_PROGRESS", currentOwnerPersonId: e2eUsers.minister.personId });
  expect(await prisma.demandOwnerHistory.count({ where: { demandId: transferDemand.id, activeKey: 1, personId: e2eUsers.minister.personId } })).toBe(1);
  await authenticated.context.close();
});

test("stale reminder closes after progress and alumni township can finish without a fake owner", async ({ browser }) => {
  const prisma = getPrismaClient();
  const staleDemand = await createOwnerDemand(e2eUsers.normal.personId, "E2E 久未更新", new Date(Date.now() - 40 * 86_400_000));
  let authenticated = await login(browser, e2eUsers.groupLeader);
  let page = authenticated.page;
  await page.goto(`/demands/${staleDemand.id}`);
  await expect(page.getByText("超过 30 天，需催办", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "发送催办" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  await deliverLifecycleEvents(staleDemand.id);
  expect(await prisma.todo.findFirstOrThrow({ where: { aggregateId: staleDemand.id, personId: e2eUsers.normal.personId, todoType: "DEMAND_UPDATE_STALE" } })).toMatchObject({ status: "OPEN" });
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.normal);
  page = authenticated.page;
  await page.goto(`/demands/${staleDemand.id}`);
  await page.locator('textarea[name="currentProgress"]').fill("收到提醒后已完成新一轮沟通");
  await page.locator('textarea[name="nextStep"]').fill("推进专家现场诊断");
  await page.getByRole("button", { name: "提交进展" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  await deliverLifecycleEvents(staleDemand.id);
  expect(await prisma.todo.findFirstOrThrow({ where: { aggregateId: staleDemand.id, personId: e2eUsers.normal.personId, todoType: "DEMAND_UPDATE_STALE" } })).toMatchObject({ status: "STALE" });
  await authenticated.context.close();

  const alumniDemand = await prisma.demand.create({ data: {
    businessNo: `XQ2026${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    enterpriseId: enterpriseE2e.enterpriseId,
    responsibleAreaId: enterpriseE2e.areaAId,
    selectedContactId: enterpriseE2e.contactId,
    title: `E2E 往届镇区责任 ${randomUUID().slice(0, 8)}`,
    originalDescription: "验证平台往届协助和属地经办办结。",
    demandType: "TALENT",
    urgency: "NORMAL",
    status: "IN_PROGRESS",
    creationBatchId: enterpriseE2e.batchId,
    currentFollowBatchId: enterpriseE2e.batchId,
    firstPublishedAt: new Date(),
    createdByPersonId: e2eUsers.admin.personId,
  } });
  await prisma.demandTownshipHandler.create({ data: { demandId: alumniDemand.id, personId: e2eUsers.township.personId, organizationId: enterpriseE2e.organizationId, assignedByPersonId: e2eUsers.admin.personId, reason: "属地承接往届协助", activeKey: 1 } });
  await prisma.demandAlumniHelper.create({ data: { demandId: alumniDemand.id, personId: e2eUsers.alumni.personId, helperKind: "PLATFORM", createdByPersonId: e2eUsers.admin.personId, reason: "平台往届愿意协助", activeKey: 1 } });

  authenticated = await login(browser, e2eUsers.alumni);
  page = authenticated.page;
  await page.goto(`/demands/${alumniDemand.id}`);
  await expect(page.getByText(/属地经办：E2E township/)).toBeVisible();
  await page.locator('textarea[name="currentProgress"]').fill("已提供产业资源清单");
  await page.locator('textarea[name="nextStep"]').fill("由属地确认落地结果");
  await page.getByRole("button", { name: "提交进展" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.township);
  page = authenticated.page;
  await page.goto(`/demands/${alumniDemand.id}`);
  await page.locator('textarea[name="solution"]').fill("往届资源对接已经完成");
  await page.locator('textarea[name="connectedResources"]').fill("产业专家与高校团队");
  await page.getByRole("button", { name: "提交属地审核" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  await page.goto(`/admin/demands/${alumniDemand.id}`);
  await page.locator('textarea[name="townshipVerificationResult"]').fill("属地已核实往届资源实际落地");
  await page.getByRole("radio", { name: "需要跟踪", exact: true }).check();
  await page.locator('input[name="firstTrackingDate"]').fill(shanghaiDateString(new Date()));
  await page.getByRole("button", { name: "确认办结并建立成效计划" }).click();
  await expect(page.getByText("需求已办结", { exact: true })).toBeVisible();
  expect(await prisma.demand.findUniqueOrThrow({ where: { id: alumniDemand.id } })).toMatchObject({ status: "COMPLETED", currentOwnerPersonId: null });
  expect(await prisma.demandOwnerHistory.count({ where: { demandId: alumniDemand.id } })).toBe(0);
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.alumni);
  page = authenticated.page;
  await page.goto(`/demands/${alumniDemand.id}`);
  await expect(page.getByRole("heading", { name: "填报本轮成效" })).toHaveCount(0);
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.township);
  page = authenticated.page;
  await page.goto(`/demands/${alumniDemand.id}`);
  await expect(page.getByRole("heading", { name: "填报本轮成效" })).toBeVisible();
  await authenticated.context.close();
});
