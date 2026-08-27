import { expect, test, type Browser, type Page } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { e2eUsers, enterpriseE2e, seedAuthFixtures } from "./auth-fixtures";

declare global {
  interface Window { __tripGpsCalls: number }
}

type User = { phone: string; password: string };

async function authenticatedPage(browser: Browser, user: User, monitorGps = false) {
  const context = await browser.newContext();
  const page = await context.newPage();
  if (monitorGps) {
    await page.addInitScript(() => {
      Object.defineProperty(window, "__tripGpsCalls", { value: 0, writable: true });
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition = () => { window.__tripGpsCalls += 1; };
        navigator.geolocation.watchPosition = () => { window.__tripGpsCalls += 1; return 1; };
      }
    });
  }
  await page.goto("/login");
  await page.getByLabel("手机号").fill(user.phone);
  await page.getByLabel("密码", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return { context, page };
}

async function apiPost(page: Page, path: string, body: unknown, idempotencyKey?: string) {
  return page.evaluate(async ({ path, body, idempotencyKey }) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) },
      body: JSON.stringify(body),
    });
    return { status: response.status, payload: await response.json() };
  }, { path, body, idempotencyKey });
}

const node = (enterpriseId: string, hour: number) => ({
  plannedStartAt: `2026-08-20T${String(hour).padStart(2, "0")}:00:00+08:00`,
  plannedEndAt: `2026-08-20T${String(hour + 1).padStart(2, "0")}:00:00+08:00`,
  enterpriseId,
  locationName: `E2E 企业 ${hour}`,
  address: "TEST ONLY",
  content: "现场走访并梳理服务需求",
});

test.beforeEach(async () => { await seedAuthFixtures(); });

test("B-M2-004 Trip, participant, Visit and DemandLead acceptance chain", async ({ browser }) => {
  const normalSession = await authenticatedPage(browser, e2eUsers.normal, true);
  const ministerSession = await authenticatedPage(browser, e2eUsers.minister);
  const ministerOnlySession = await authenticatedPage(browser, e2eUsers.ministerOnly);
  const leaderSession = await authenticatedPage(browser, e2eUsers.groupLeader);
  const alumniSession = await authenticatedPage(browser, e2eUsers.alumni);
  const departmentSession = await authenticatedPage(browser, e2eUsers.department);
  const adminSession = await authenticatedPage(browser, e2eUsers.admin);
  const normal = normalSession.page;
  const prisma = getPrismaClient();
  const noAccountPersonId = "10000000-0000-4000-8000-000000000013";

  try {
    await prisma.person.upsert({
      where: { id: noAccountPersonId },
      create: { id: noAccountPersonId, name: "E2E 无账号参与人" },
      update: { name: "E2E 无账号参与人", personStatus: "ACTIVE" },
    });
    await prisma.enterprise.createMany({ data: [
      { id: enterpriseE2e.enterprise2Id, name: "E2E 荷乡科技企业", responsibleAreaId: enterpriseE2e.areaAId, address: "宝应县安宜镇测试大道2号", mainProducts: "新能源装备", createdByPersonId: e2eUsers.admin.personId },
      { id: enterpriseE2e.enterprise3Id, name: "E2E 湖畔制造企业", responsibleAreaId: enterpriseE2e.areaBId, address: "宝应县射阳湖镇测试大道3号", mainProducts: "精密制造", createdByPersonId: e2eUsers.admin.personId },
    ] });
    await normal.goto("/trips/new");
    const participantSelect = normal.getByLabel("共享参与人（可多选）");
    await expect(participantSelect).toBeVisible();
    await expect(participantSelect.locator(`option[value="${e2eUsers.minister.personId}"]`)).toHaveCount(1);
    await expect(participantSelect.locator(`option[value="${noAccountPersonId}"]`)).toHaveCount(0);

    const created = await apiPost(normal, "/api/v2/trips", {
      title: "E2E 三企业共享行程",
      purpose: "逐项验证工作行程与企业走访",
      participantIds: [e2eUsers.minister.personId],
      nodes: [
        node(enterpriseE2e.enterpriseId, 9),
        node(enterpriseE2e.enterprise2Id, 11),
        node(enterpriseE2e.enterprise3Id, 14),
      ],
    });
    expect(created.status).toBe(201);
    const tripId = created.payload.data.id as string;
    const tripNodeIds = (created.payload.data.nodes as Array<{ id: string }>).map(({ id }) => id);

    const rejectedNoAccount = await apiPost(normal, `/api/v2/trips/${tripId}/participants`, { personId: noAccountPersonId });
    expect(rejectedNoAccount.status).toBe(422);
    expect(rejectedNoAccount.payload).toMatchObject({ error: { code: "TRIP_PARTICIPANT_INVALID" } });

    const added = await apiPost(normal, `/api/v2/trips/${tripId}/participants`, { personId: e2eUsers.groupLeader.personId });
    expect(added.status).toBe(200);
    const left = await apiPost(leaderSession.page, `/api/v2/trips/${tripId}/participants/leave`, {});
    expect(left.status).toBe(200);

    const personal = await apiPost(normal, "/api/v2/trips", {
      title: "E2E 最后一人退出门禁",
      purpose: "验证最后参与人不能退出",
      nodes: [{ plannedStartAt: "2026-08-18T09:00:00+08:00", locationName: "E2E 自由地点", content: "TEST ONLY" }],
    });
    expect(personal.status).toBe(201);
    const tooEarlyOverall = await apiPost(normal, `/api/v2/trips/${personal.payload.data.id}/update`, {
      overallEndAt: "2026-08-18T08:00:00+08:00",
    });
    expect(tooEarlyOverall.status).toBe(422);
    expect(tooEarlyOverall.payload).toMatchObject({ error: { code: "TRIP_NODE_INVALID" } });
    const lastLeave = await apiPost(normal, `/api/v2/trips/${personal.payload.data.id}/participants/leave`, {});
    expect(lastLeave.status).toBe(409);
    expect(lastLeave.payload).toMatchObject({ error: { code: "TRIP_LAST_PARTICIPANT_CANNOT_LEAVE" } });

    const noPresence = await apiPost(alumniSession.page, "/api/v2/trips", {
      title: "E2E 往届无报备行程",
      purpose: "必须拒绝",
      nodes: [{ plannedStartAt: "2026-09-13T10:00:00+08:00", plannedEndAt: "2026-09-13T11:00:00+08:00", locationName: "E2E 无覆盖地点", content: "TEST ONLY" }],
    });
    expect(noPresence.status).toBe(422);
    expect(noPresence.payload).toMatchObject({ error: { code: "TRIP_ALUMNI_PRESENCE_REQUIRED" } });
    const coveredPresence = await apiPost(alumniSession.page, "/api/v2/trips", {
      title: "E2E 往届有报备个人行程",
      purpose: "覆盖报备内允许",
      nodes: [{ plannedStartAt: "2026-09-12T10:00:00+08:00", plannedEndAt: "2026-09-12T11:00:00+08:00", locationName: "E2E 报备覆盖地点", content: "TEST ONLY" }],
    });
    expect(coveredPresence.status).toBe(201);
    expect(coveredPresence.payload.data.participants).toHaveLength(1);
    const outsidePresence = await apiPost(alumniSession.page, `/api/v2/trips/${coveredPresence.payload.data.id}/update`, {
      overallEndAt: "2026-09-12T19:00:00+08:00",
    });
    expect(outsidePresence.status).toBe(422);
    expect(outsidePresence.payload).toMatchObject({ error: { code: "TRIP_ALUMNI_PRESENCE_REQUIRED" } });

    const ministerTrip = await apiPost(ministerOnlySession.page, "/api/v2/trips", {
      title: "E2E 纯 MINISTER 团队行程",
      purpose: "验证创建后维护权限",
      nodes: [{ plannedStartAt: "2026-08-17T09:00:00+08:00", plannedEndAt: "2026-08-17T10:00:00+08:00", locationName: "E2E MINISTER 地点", content: "TEST ONLY" }],
    });
    expect(ministerTrip.status).toBe(201);
    const ministerTripId = ministerTrip.payload.data.id as string;
    const ministerUpdate = await apiPost(ministerOnlySession.page, `/api/v2/trips/${ministerTripId}/update`, { title: "E2E 纯 MINISTER 已更新" });
    expect(ministerUpdate.status).toBe(403);
    expect(ministerUpdate.payload).toMatchObject({ error: { code: "FORBIDDEN_CAPABILITY" } });
    const ministerCancel = await apiPost(ministerOnlySession.page, `/api/v2/trips/${ministerTripId}/cancel`, { reason: "E2E 纯 MINISTER 取消" });
    expect(ministerCancel.status).toBe(403);
    expect(ministerCancel.payload).toMatchObject({ error: { code: "FORBIDDEN_CAPABILITY" } });
    expect(await prisma.auditLog.findMany({
      where: { actorPersonId: e2eUsers.ministerOnly.personId, entityId: ministerTripId },
      orderBy: { actionCode: "asc" },
      select: { actionCode: true },
    })).toEqual([{ actionCode: "TRIP_CREATED" }]);

    const departmentTrip = await apiPost(departmentSession.page, "/api/v2/trips", {
      title: "E2E 部门县外行程",
      purpose: "跨区域服务",
      nodes: [{ plannedStartAt: "2026-08-19T09:00:00+08:00", locationName: "南京市县外会场", address: "南京市 TEST ONLY", content: "县外活动" }],
    });
    expect(departmentTrip.status).toBe(201);
    expect(departmentTrip.payload.data.nodes[0]).toMatchObject({ enterpriseId: null, locationName: "南京市县外会场" });

    const idempotencyKey = "e2e-result-shared-trip-001";
    const resultBody = {
      resultSummary: "完成三家企业走访并形成服务清单",
      nodeResults: tripNodeIds.map((tripNodeId, index) => ({ tripNodeId, resultSummary: `第 ${index + 1} 家企业走访结果` })),
    };
    const submitted = await apiPost(ministerSession.page, `/api/v2/trips/${tripId}/result`, resultBody, idempotencyKey);
    expect(submitted.status).toBe(201);
    expect(submitted.payload.data.visits).toHaveLength(3);
    const retried = await apiPost(ministerSession.page, `/api/v2/trips/${tripId}/result`, resultBody, idempotencyKey);
    expect(retried.status).toBe(201);
    expect(retried.payload.data.result.id).toBe(submitted.payload.data.result.id);

    await normal.goto(`/trips/${tripId}`);
    await expect(normal.getByRole("heading", { name: "E2E 三企业共享行程" })).toBeVisible();
    await expect(normal.getByText("完成三家企业走访并形成服务清单", { exact: true })).toBeVisible();
    await expect(normal.getByRole("heading", { name: "企业走访" })).toBeVisible();
    await expect(normal.getByText("走访阶段不填写需求类型和紧急程度，由镇区核验时补充。").first()).toBeVisible();
    await expect(normal.getByLabel(/需求类型|紧急程度/)).toHaveCount(0);

    const visitId = submitted.payload.data.visits[0].id as string;
    const supplement = await apiPost(ministerSession.page, `/api/v2/visits/${visitId}/supplements`, { content: "另一参与人追加的现场信息" });
    expect(supplement.status).toBe(201);
    const leadOne = await apiPost(normal, `/api/v2/visits/${visitId}/demand-leads`, {
      title: "E2E 第一条走访需求", description: "企业希望对接金融产品",
    }, "e2e-visit-lead-001");
    const leadTwo = await apiPost(normal, `/api/v2/visits/${visitId}/demand-leads`, {
      title: "E2E 第二条不同需求", description: "企业希望对接技术专家",
    }, "e2e-visit-lead-002");
    expect(leadOne.status).toBe(201);
    expect(leadTwo.status).toBe(201);
    expect(leadTwo.payload.data.id).not.toBe(leadOne.payload.data.id);

    const lockedUpdate = await apiPost(normal, `/api/v2/trips/${tripId}/update`, {
      nodes: [node(enterpriseE2e.enterpriseId, 8)],
    });
    expect(lockedUpdate.status).toBe(409);
    expect(lockedUpdate.payload).toMatchObject({ error: { code: "TRIP_STATE_CONFLICT" } });

    const sourceBefore = await prisma.demandLead.findUniqueOrThrow({ where: { id: leadOne.payload.data.id }, select: {
      sourceType: true, sourceChannel: true, sourceAt: true, tripId: true, visitId: true, rawContent: true,
    } });
    const corrected = await apiPost(adminSession.page, `/api/v2/admin/visits/${visitId}/correct`, {
      changes: { visitedAt: "2026-08-20T10:30:00+08:00", visitSummary: "Admin 线下核实后的走访摘要" },
      reason: "E2E 线下材料核验",
    });
    expect(corrected.status).toBe(200);
    const sourceAfter = await prisma.demandLead.findUniqueOrThrow({ where: { id: leadOne.payload.data.id }, select: {
      sourceType: true, sourceChannel: true, sourceAt: true, tripId: true, visitId: true, rawContent: true,
    } });
    expect(sourceAfter).toEqual(sourceBefore);
    expect(await prisma.enterpriseVisit.count({ where: { tripId } })).toBe(3);
    expect(await prisma.visitSupplement.count({ where: { visitId } })).toBe(1);
    expect(await prisma.demandLead.count({ where: { visitId } })).toBe(2);
    const tripEvents = await prisma.outboxEvent.findMany({
      where: { aggregateType: "TRIP", aggregateId: tripId },
      select: { eventType: true },
      orderBy: { eventType: "asc" },
    });
    expect(tripEvents).toEqual([
      { eventType: "TRIP_PARTICIPANT_ADDED" },
      { eventType: "TRIP_PARTICIPANT_ADDED" },
      { eventType: "TRIP_RESULT_DUE_SCHEDULED" },
      { eventType: "TRIP_RESULT_SUBMITTED" },
    ]);
    expect(await normal.evaluate(() => window.__tripGpsCalls)).toBe(0);
  } finally {
    await prisma.person.deleteMany({ where: { id: noAccountPersonId } });
    await Promise.all([
      normalSession.context.close(), ministerSession.context.close(), ministerOnlySession.context.close(), leaderSession.context.close(),
      alumniSession.context.close(), departmentSession.context.close(), adminSession.context.close(),
    ]);
  }
});
