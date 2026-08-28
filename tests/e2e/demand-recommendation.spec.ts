import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { AIService, FakeDemandMatchProvider } from "@/modules/ai";
import { DemandRecommendationService } from "@/modules/demand";
import { DemandAlumniHelpActivatedNotificationHandler, DemandAlumniResponseNotificationHandler, DemandRecommendationNotificationHandler } from "@/modules/outbox/handlers/demand-recommendation-notification-handler";
import { OutboxHandlerRegistry } from "@/modules/outbox/outbox-handler-registry";
import { enterpriseE2e, e2eUsers, seedAuthFixtures } from "./auth-fixtures";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

async function login(browser: Browser, user: { phone: string; password: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.request.post("/api/v2/auth/login", { headers: { origin: "http://127.0.0.1:3000" }, data: { phone: user.phone, password: user.password } });
  expect(response.status()).toBe(200);
  await page.goto("/");
  return { context, page };
}

async function post(page: Page, path: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await page.request.post(path, { headers: { origin: "http://127.0.0.1:3000", ...headers }, data: body });
  return { status: response.status(), payload: await response.json() };
}

async function get(page: Page, path: string) {
  const response = await page.request.get(path);
  return { status: response.status(), payload: await response.json() };
}

async function demand(daysAgo = 0) {
  const prisma = getPrismaClient();
  return prisma.demand.create({ data: {
    businessNo: `XQ2026${randomUUID().replaceAll("-", "").slice(0, 10)}`,
    enterpriseId: enterpriseE2e.enterpriseId,
    responsibleAreaId: enterpriseE2e.areaAId,
    selectedContactId: enterpriseE2e.contactId,
    title: `E2E 智能制造推荐 ${randomUUID().slice(0, 8)}`,
    originalDescription: "需要智能制造与工业软件方向的真实能力与资源协助。",
    demandType: "TECHNICAL",
    status: "PENDING_CLAIM",
    creationBatchId: enterpriseE2e.batchId,
    currentFollowBatchId: enterpriseE2e.batchId,
    firstPublishedAt: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1_000),
    createdByPersonId: e2eUsers.admin.personId,
  } });
}

async function capability(personId: string) {
  await getPrismaClient().memberCapabilityProfile.create({ data: {
    personId,
    updatedByPersonId: personId,
    professionalDirection: "智能制造与工业软件",
    coordinatableResources: "工业机器人与自动化专家",
    preferredDemandTypes: { create: { demandType: "TECHNICAL" } },
  } });
}

function provider(personIds: string[]) {
  return new FakeDemandMatchProvider((request) => ({ recommendations: personIds.filter((id) => request.input.candidates.some(({ candidateId }) => candidateId === id)).map((candidateId) => ({ candidateId, reason: "专业方向与需求一致，且有真实能力画像依据。", evidenceKeys: ["PREFERRED_DEMAND_TYPE"] })).slice(0, 3) }));
}

async function dispatchRecommendationNotifications(demandId: string) {
  const prisma = getPrismaClient();
  const registry = new OutboxHandlerRegistry();
  registry.register("DEMAND_RECOMMENDED_CURRENT", new DemandRecommendationNotificationHandler("DEMAND_RECOMMENDED_CURRENT"));
  registry.register("DEMAND_RECOMMENDED_ALUMNI", new DemandRecommendationNotificationHandler("DEMAND_RECOMMENDED_ALUMNI"));
  registry.register("DEMAND_ALUMNI_RESPONSE_RECORDED", new DemandAlumniResponseNotificationHandler());
  registry.register("DEMAND_ALUMNI_HELP_ACTIVATED", new DemandAlumniHelpActivatedNotificationHandler());
  const events = await prisma.outboxEvent.findMany({
    where: { aggregateId: demandId, eventType: { in: ["DEMAND_RECOMMENDED_CURRENT", "DEMAND_RECOMMENDED_ALUMNI", "DEMAND_ALUMNI_RESPONSE_RECORDED", "DEMAND_ALUMNI_HELP_ACTIVATED"] }, publishedAt: null },
    orderBy: { occurredAt: "asc" },
  });
  for (const event of events) await prisma.$transaction(async (tx) => {
    await registry.dispatch(event, tx);
    await tx.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date() } });
  });
}

test.beforeEach(async () => { await seedAuthFixtures(); });

test("CURRENT recommendation is role-filtered, decline excludes rerun, and another member can still claim", async ({ browser }) => {
  await capability(e2eUsers.minister.personId);
  const item = await demand();
  let authenticated = await login(browser, e2eUsers.admin);
  let page = authenticated.page;
  const requested = await post(page, `/api/v2/demands/${item.id}/recommendations/run`, { stage: "CURRENT" }, { "Idempotency-Key": randomUUID() });
  expect(requested.status).toBe(202);
  await new DemandRecommendationService().executeRun(requested.payload.data.runId, new AIService(provider([e2eUsers.minister.personId])));
  await dispatchRecommendationNotifications(item.id);
  await page.goto(`/admin/demands/${item.id}`);
  await expect(page.getByRole("heading", { name: "智能推荐" })).toBeVisible();
  await expect(page.getByText("E2E minister", { exact: true })).toBeVisible();
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.groupLeader);
  page = authenticated.page;
  expect((await get(page, `/api/v2/demands/${item.id}/recommendations`)).payload.data.items).toEqual([]);
  await page.goto(`/demands/${item.id}`);
  await expect(page.getByRole("heading", { name: "智能推荐" })).toHaveCount(0);
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.minister);
  page = authenticated.page;
  const own = await get(page, `/api/v2/demands/${item.id}/recommendations`);
  expect(own.payload.data.items).toHaveLength(1);
  const currentMessages = await get(page, "/api/v2/messages?module=DEMAND&pageSize=100");
  expect(currentMessages.payload.data.items.filter((entry: { aggregateId: string; messageType: string }) => entry.aggregateId === item.id && entry.messageType === "DEMAND_RECOMMENDED_CURRENT")).toHaveLength(1);
  const currentTodos = await get(page, "/api/v2/todos?module=DEMAND&pageSize=100");
  expect(currentTodos.payload.data.items.filter((entry: { aggregateId: string }) => entry.aggregateId === item.id)).toHaveLength(0);
  await page.goto(`/demands/${item.id}`);
  await expect(page.getByRole("button", { name: "暂不参与" })).toBeVisible();
  expect((await post(page, `/api/v2/demands/${item.id}/recommendations/${own.payload.data.items[0].id}/respond`, { response: "DECLINE" })).status).toBe(200);
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  const rerun = await post(page, `/api/v2/demands/${item.id}/recommendations/run`, { stage: "CURRENT" }, { "Idempotency-Key": randomUUID() });
  await new DemandRecommendationService().executeRun(rerun.payload.data.runId, new AIService(provider([e2eUsers.minister.personId])));
  expect((await get(page, `/api/v2/demands/${item.id}/recommendations`)).payload.data.items).toEqual([]);
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.groupLeader);
  expect((await post(authenticated.page, `/api/v2/demands/${item.id}/claim`, {}, { "Idempotency-Key": randomUUID() })).status).toBe(200);
  await authenticated.context.close();
});

test("ALUMNI platform and historical responses lead to a formal helper plus township handler", async ({ browser }) => {
  const prisma = getPrismaClient();
  await capability(e2eUsers.alumni.personId);
  const historical = await prisma.person.create({ data: { name: `E2E 历史往届 ${randomUUID().slice(0, 8)}` } });
  await prisma.batchMembership.create({ data: { personId: historical.id, batchId: enterpriseE2e.pastBatchId, startDate: new Date("2025-01-01"), endDate: new Date("2025-12-31"), status: "COMPLETED" } });
  await capability(historical.id);
  const item = await demand(31);
  await prisma.demandRecommendationRun.create({ data: { demandId: item.id, stage: "CURRENT", status: "SUCCEEDED", triggerType: "ADMIN", rulesVersion: "e2e", currentKey: 1, finishedAt: new Date() } });

  let authenticated = await login(browser, e2eUsers.admin);
  let page = authenticated.page;
  const requested = await post(page, `/api/v2/demands/${item.id}/recommendations/run`, { stage: "ALUMNI" }, { "Idempotency-Key": randomUUID() });
  expect(requested.status).toBe(202);
  await new DemandRecommendationService().executeRun(requested.payload.data.runId, new AIService(provider([e2eUsers.alumni.personId, historical.id])));
  await dispatchRecommendationNotifications(item.id);
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.alumni);
  page = authenticated.page;
  const alumniView = await get(page, `/api/v2/demands/${item.id}/recommendations`);
  expect(alumniView.payload.data.items).toHaveLength(1);
  expect((await get(page, "/api/v2/messages?module=DEMAND&pageSize=100")).payload.data.items.filter((entry: { aggregateId: string; messageType: string }) => entry.aggregateId === item.id && entry.messageType === "DEMAND_RECOMMENDED_ALUMNI")).toHaveLength(1);
  expect((await get(page, "/api/v2/todos?module=DEMAND&pageSize=100")).payload.data.items.filter((entry: { aggregateId: string; todoType: string }) => entry.aggregateId === item.id && entry.todoType === "DEMAND_ALUMNI_RESPONSE")).toHaveLength(1);
  expect((await post(page, `/api/v2/demands/${item.id}/recommendations/${alumniView.payload.data.items[0].id}/respond`, { response: "WILLING" })).status).toBe(200);
  await dispatchRecommendationNotifications(item.id);
  expect((await get(page, "/api/v2/todos?module=DEMAND&pageSize=100")).payload.data.items.filter((entry: { aggregateId: string }) => entry.aggregateId === item.id)).toHaveLength(0);
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.township);
  page = authenticated.page;
  const townshipView = await get(page, `/api/v2/demands/${item.id}/recommendations`);
  expect(townshipView.payload.data.items).toHaveLength(2);
  const historicalItem = townshipView.payload.data.items.find((entry: { person: { id: string } }) => entry.person.id === historical.id);
  expect((await post(page, `/api/v2/demands/${item.id}/recommendations/${historicalItem.id}/respond`, { response: "DECLINE", responseNote: "线下联系后暂不参与" })).status).toBe(200);
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  const adminView = await get(page, `/api/v2/demands/${item.id}/recommendations`);
  const willing = adminView.payload.data.items.find((entry: { person: { id: string } }) => entry.person.id === e2eUsers.alumni.personId);
  expect((await post(page, `/api/v2/demands/${item.id}/alumni-help/activate`, { recommendationItemId: willing.id, townshipHandlerPersonId: e2eUsers.township.personId, reason: "E2E 已确认往届协助意愿" })).status).toBe(200);
  await dispatchRecommendationNotifications(item.id);
  const after = await get(page, `/api/v2/demands/${item.id}/recommendations`);
  expect(after.payload.data.responsibility).toMatchObject({ mode: "ALUMNI_TOWNSHIP", townshipHandlerPersonId: e2eUsers.township.personId });
  expect(await prisma.demand.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "IN_PROGRESS", currentOwnerPersonId: null });
  await page.goto(`/admin/demands/${item.id}`);
  await expect(page.getByText("该需求已进入“往届协助 + 镇区经办”责任模式。")).toBeVisible();
  await authenticated.context.close();
});
