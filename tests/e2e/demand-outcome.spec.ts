import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { shanghaiDateString } from "@/modules/demand/outcome-date";
import { DemandOutcomeDueJobHandler } from "@/modules/jobs/handlers/demand-outcome-due-handler";
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
  return { context, page };
}

async function createOwnerDemand() {
  const prisma = getPrismaClient();
  const demand = await prisma.demand.create({ data: {
    businessNo: `XQ2026${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    enterpriseId: enterpriseE2e.enterpriseId,
    responsibleAreaId: enterpriseE2e.areaAId,
    selectedContactId: enterpriseE2e.contactId,
    title: `E2E 成效跟踪 ${randomUUID().slice(0, 8)}`,
    originalDescription: "验证需求办结后的正式成效跟踪闭环。",
    demandType: "PROJECT",
    urgency: "NORMAL",
    status: "IN_PROGRESS",
    creationBatchId: enterpriseE2e.batchId,
    currentFollowBatchId: enterpriseE2e.batchId,
    currentOwnerPersonId: e2eUsers.normal.personId,
    firstPublishedAt: new Date(),
    createdByPersonId: e2eUsers.admin.personId,
  } });
  await prisma.demandOwnerHistory.create({ data: {
    demandId: demand.id,
    personId: e2eUsers.normal.personId,
    batchId: enterpriseE2e.batchId,
    effectiveAt: new Date(),
    changeType: "CLAIM",
    createdByPersonId: e2eUsers.normal.personId,
    activeKey: 1,
  } });
  return demand;
}

async function deliverOutcomeEvents(demandId: string) {
  const prisma = getPrismaClient();
  const registry = new OutboxHandlerRegistry();
  for (const eventType of DEMAND_LIFECYCLE_NOTIFICATION_EVENTS) {
    registry.register(eventType, new DemandProgressCloseNotificationHandler(eventType));
  }
  await prisma.$transaction(async (tx) => {
    const events = await tx.outboxEvent.findMany({
      where: { aggregateId: demandId, publishedAt: null, eventType: { in: [...DEMAND_LIFECYCLE_NOTIFICATION_EVENTS] } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
    for (const event of events) {
      await registry.dispatch(event, tx);
      await tx.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date() } });
    }
  });
}

async function submitFirstRound(page: Page, trackingDate: string, nextTrackingDate: string) {
  await page.getByRole("heading", { name: "填报本轮成效" }).locator("..").locator('input[name="trackingDate"]').fill(trackingDate);
  await page.locator('input[name="contractAmountIncrement"]').fill("100.50");
  await page.locator('textarea[name="qualitativeResult"]').fill("形成首轮正式合作成效");
  await page.locator('input[name="nextTrackingDate"]').fill(nextTrackingDate);
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("草稿", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "提交管理员审核" }).click();
  await expect(page.getByText("待审核", { exact: true })).toBeVisible();
}

test.beforeEach(async () => { await seedAuthFixtures(); });

test("completed demand follows the tracked outcome lifecycle and exposes only approved facts", async ({ browser }) => {
  const prisma = getPrismaClient();
  const today = shanghaiDateString(new Date());
  const tomorrow = shanghaiDateString(new Date(Date.now() + 86_400_000));
  const demand = await createOwnerDemand();

  let authenticated = await login(browser, e2eUsers.normal);
  let page = authenticated.page;
  await page.goto(`/demands/${demand.id}`);
  await page.locator('textarea[name="solution"]').fill("已完成项目方案和资源对接");
  await page.locator('textarea[name="connectedResources"]').fill("高校实验室与产业基金");
  await page.getByRole("button", { name: "提交属地审核" }).click();
  await expect(page.getByText("待办结审核", { exact: true })).toBeVisible();
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  await page.goto(`/admin/demands/${demand.id}`);
  await page.locator('textarea[name="townshipVerificationResult"]').fill("已向企业核验办结事实");
  await page.getByLabel("需要跟踪").check();
  await page.locator('input[name="firstTrackingDate"]').fill(today);
  await page.getByRole("button", { name: "确认办结并建立成效计划" }).click();
  await expect(page.getByText("待首次跟踪", { exact: true })).toBeVisible();
  expect(await prisma.demand.findUniqueOrThrow({ where: { id: demand.id } })).toMatchObject({ status: "COMPLETED" });
  const plan = await prisma.demandOutcomePlan.findUniqueOrThrow({ where: { demandId: demand.id } });
  expect(plan).toMatchObject({ status: "PENDING", trackingMode: "TRACKING", dueVersion: 1 });
  await authenticated.context.close();

  await new DemandOutcomeDueJobHandler(prisma, () => new Date()).handle({
    planId: plan.id,
    dueVersion: 1,
    dueDate: today,
    eventKey: `outcome-due:${plan.id}:1`,
  });
  await deliverOutcomeEvents(demand.id);
  expect(await prisma.todo.count({ where: { aggregateId: demand.id, personId: e2eUsers.township.personId, todoType: "OUTCOME_FILL", status: "OPEN" } })).toBe(1);

  authenticated = await login(browser, e2eUsers.township);
  page = authenticated.page;
  await page.goto(`/demands/${demand.id}`);
  await submitFirstRound(page, today, tomorrow);
  const firstRound = await prisma.demandOutcomeRound.findFirstOrThrow({ where: { demandId: demand.id, roundNo: 1 } });
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.normal);
  page = authenticated.page;
  await page.goto(`/demands/${demand.id}`);
  await expect(page.getByText("暂无成效轮次。")).toBeVisible();
  await expect(page.getByText("¥0.00").first()).toBeVisible();
  const forbidden = await page.request.post(`/api/v2/demand-outcomes/${firstRound.id}/update`, {
    headers: { "content-type": "application/json", origin: "http://127.0.0.1:3000" },
    data: { expectedVersion: firstRound.editVersion, trackingDate: today, contractAmountIncrement: "999", investmentAmountIncrement: "0", policyFundIncrement: "0", costReductionIncrement: "0", talentIntroducedIncrement: 0, patentIncrement: 0, nextTrackingDate: tomorrow, endTracking: false, attachmentIds: [] },
  });
  expect(forbidden.status()).toBe(403);
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  await page.goto(`/admin/demands/${demand.id}`);
  await page.locator('textarea[name="returnReason"]').fill("请补充企业确认结果");
  await page.getByRole("button", { name: "退回修改" }).click();
  await expect(page.getByText("已退回", { exact: true })).toBeVisible();
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.township);
  page = authenticated.page;
  await page.goto(`/demands/${demand.id}`);
  await expect(page.getByText("退回原因：请补充企业确认结果")).toBeVisible();
  await page.locator('textarea[name="enterpriseFeedback"]').fill("企业确认合作已产生实际合同");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  await page.getByRole("button", { name: "提交管理员审核" }).click();
  await expect(page.getByText("待审核", { exact: true })).toBeVisible();
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  await page.goto(`/admin/demands/${demand.id}`);
  await page.locator('textarea[name="verifiedNote"]').fill("管理员已电话核实合同金额");
  await page.getByRole("button", { name: "审核通过" }).click();
  await expect(page.getByText("跟踪中", { exact: true })).toBeVisible();
  expect((await prisma.demandOutcomePlan.findUniqueOrThrow({ where: { id: plan.id } })).status).toBe("IN_PROGRESS");
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.normal);
  page = authenticated.page;
  await page.goto(`/demands/${demand.id}`);
  await expect(page.getByText("已通过", { exact: true })).toBeVisible();
  await expect(page.getByText("¥100.50", { exact: true }).first()).toBeVisible();
  await authenticated.context.close();

  await prisma.demandOutcomePlan.update({ where: { id: plan.id }, data: { nextTrackingDate: new Date(`${today}T00:00:00.000Z`) } });
  authenticated = await login(browser, e2eUsers.township);
  page = authenticated.page;
  await page.goto(`/demands/${demand.id}`);
  await page.locator('input[name="trackingDate"]').fill(today);
  await page.locator('textarea[name="qualitativeResult"]').fill("最终成效已确认，结束跟踪");
  await page.locator('input[name="endTracking"]').check();
  await page.getByRole("button", { name: "保存草稿" }).click();
  await page.getByRole("button", { name: "提交管理员审核" }).click();
  await expect(page.getByText("待审核", { exact: true })).toBeVisible();
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  await page.goto(`/admin/demands/${demand.id}`);
  await page.locator('textarea[name="verifiedNote"]').fill("最终成效已经线下核实");
  await page.getByRole("button", { name: "审核通过" }).click();
  await expect(page.getByText("已结束", { exact: true })).toBeVisible();
  expect(await prisma.demandOutcomePlan.findUniqueOrThrow({ where: { id: plan.id } })).toMatchObject({ status: "ENDED", nextTrackingDate: null, endedAt: expect.any(Date) });
  await deliverOutcomeEvents(demand.id);
  expect(await prisma.todo.count({ where: { aggregateId: demand.id, todoType: { in: ["OUTCOME_FILL", "OUTCOME_REVIEW", "OUTCOME_REVISE"] }, status: "OPEN" } })).toBe(0);
  await authenticated.context.close();
});
