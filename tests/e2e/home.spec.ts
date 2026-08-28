import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { e2eUsers, enterpriseE2e } from "./auth-fixtures";

let prisma: ReturnType<typeof getPrismaClient>;
const ids = { announcement: "", version: "", messages: [] as string[], todos: [] as string[], helps: [] as string[], demands: [] as string[], runs: [] as string[], trips: [] as string[], presence: [] as string[] };
let recommendedDemandTitle = "";

function shanghaiDayBounds(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const day = `${part("year")}-${part("month")}-${part("day")}`;
  return { start: new Date(`${day}T00:00:00.000+08:00`), end: new Date(`${day}T23:59:59.999+08:00`) };
}

test.beforeAll(async () => {
  prisma = getPrismaClient();
  const now = new Date();
  const { start } = shanghaiDayBounds(now);
  const announcement = await prisma.announcement.create({ data: { status: "PUBLISHED", publishedAt: now, publishedByPersonId: e2eUsers.admin.personId, createdByPersonId: e2eUsers.admin.personId } });
  ids.announcement = announcement.id;
  const version = await prisma.announcementVersion.create({ data: {
    announcementId: announcement.id, versionNo: 1, title: "A-M1-008 首页重要公告", body: "关键浏览器首页公告",
    isImportant: true, needConfirm: true, createdByPersonId: e2eUsers.admin.personId,
    recipientStates: { create: { personId: e2eUsers.normal.personId } },
  } });
  ids.version = version.id;
  await prisma.announcement.update({ where: { id: announcement.id }, data: { currentVersionId: version.id } });
  const message = await prisma.message.create({ data: { personId: e2eUsers.normal.personId, messageType: "HOME_E2E", title: "首页未读", summary: "消息角标验证", dedupeKey: `home-e2e-${randomUUID()}`, eventAt: now } });
  ids.messages.push(message.id);

  const people = [e2eUsers.normal, e2eUsers.groupLeader, e2eUsers.minister, e2eUsers.admin, e2eUsers.township, e2eUsers.alumni];
  const reports = await prisma.$transaction(people.map((person, index) => prisma.presenceReport.create({ data: {
    personId: person.personId, arrivalAt: new Date(now.getTime() - (index + 1) * 60_000), expectedDepartureAt: new Date(now.getTime() + 86_400_000), note: "A-M1-008 E2E 当前在宝",
  } })));
  ids.presence.push(...reports.map(({ id }) => id));

  for (let index = 0; index < 4; index += 1) {
    const trip = await prisma.trip.create({ data: {
      title: `A-M1-008 E2E 行程 ${index}`, purpose: "首页三条上限", createdByPersonId: e2eUsers.normal.personId,
      participants: { create: [
        { personId: e2eUsers.normal.personId, isCreator: true, addedByPersonId: e2eUsers.normal.personId },
        ...(index === 0 ? [{ personId: e2eUsers.groupLeader.personId, isCreator: false, addedByPersonId: e2eUsers.normal.personId }] : []),
      ] },
      nodes: { create: { sequenceNo: 1, plannedStartAt: new Date(start.getTime() + (8 + index) * 3_600_000), plannedEndAt: new Date(start.getTime() + (9 + index) * 3_600_000), locationName: `首页地点 ${index}`, content: "走访" } },
    } });
    ids.trips.push(trip.id);
  }

  for (let index = 0; index < 4; index += 1) {
    const help = await prisma.helpRequest.create({ data: {
      businessNo: `BZ2026${randomUUID().replaceAll("-", "").slice(0, 10)}`, submitterPersonId: e2eUsers.alumni.personId,
      category: "OTHER", title: `A-M1-008 E2E 待办 ${index}`, description: "首页待办上限", urgency: index === 0 ? "URGENT" : "NORMAL", status: "IN_PROGRESS",
      currentOwnerPersonId: e2eUsers.normal.personId, expectedCompleteAt: new Date(now.getTime() + (index + 1) * 86_400_000),
    } });
    ids.helps.push(help.id);
    const todo = await prisma.todo.create({ data: { personId: e2eUsers.normal.personId, todoType: "HELP_PROCESS", module: "help", aggregateType: "HELP_REQUEST", aggregateId: help.id, actionUrl: `/help-requests/${help.id}`, dedupeKey: `home-e2e-todo-${randomUUID()}` } });
    ids.todos.push(todo.id);
  }

  for (let index = 0; index < 4; index += 1) {
    const created = await prisma.demand.create({ data: {
      businessNo: `XQ2026${randomUUID().replaceAll("-", "").slice(0, 10)}`, enterpriseId: enterpriseE2e.enterpriseId,
      responsibleAreaId: enterpriseE2e.areaAId, selectedContactId: enterpriseE2e.contactId,
      title: index === 0 ? `A-M1-008 为你推荐 ${randomUUID()}` : `A-M1-008 普通需求 ${index} ${randomUUID()}`,
      originalDescription: "首页最新需求上限和排序验证", demandType: "TECHNICAL", urgency: "NORMAL", status: "PENDING_CLAIM",
      creationBatchId: enterpriseE2e.batchId, currentFollowBatchId: enterpriseE2e.batchId,
      firstPublishedAt: new Date(now.getTime() - index * 60_000), createdByPersonId: e2eUsers.admin.personId,
    } });
    ids.demands.push(created.id);
    if (index === 0) {
      recommendedDemandTitle = created.title;
      const run = await prisma.demandRecommendationRun.create({ data: {
        demandId: created.id, stage: "CURRENT", status: "SUCCEEDED", triggerType: "ADMIN", rulesVersion: "home-e2e", currentKey: 1,
        items: { create: { personId: e2eUsers.normal.personId, candidateKind: "CURRENT", rank: 1, source: "MANUAL", reason: "E2E 首页推荐", evidenceSnapshotJson: {} } },
      } });
      ids.runs.push(run.id);
    }
  }
});

test.afterAll(async () => {
  await prisma.message.deleteMany({ where: { id: { in: ids.messages } } });
  await prisma.todo.deleteMany({ where: { id: { in: ids.todos } } });
  await prisma.helpRequest.deleteMany({ where: { id: { in: ids.helps } } });
  await prisma.demandRecommendationItem.deleteMany({ where: { runId: { in: ids.runs } } });
  await prisma.demandRecommendationRun.deleteMany({ where: { id: { in: ids.runs } } });
  await prisma.demand.deleteMany({ where: { id: { in: ids.demands } } });
  await prisma.tripNode.deleteMany({ where: { tripId: { in: ids.trips } } });
  await prisma.tripParticipant.deleteMany({ where: { tripId: { in: ids.trips } } });
  await prisma.trip.deleteMany({ where: { id: { in: ids.trips } } });
  await prisma.presenceReport.deleteMany({ where: { id: { in: ids.presence } } });
  if (ids.announcement) {
    await prisma.announcement.update({ where: { id: ids.announcement }, data: { currentVersionId: null } });
    await prisma.announcementRecipientState.deleteMany({ where: { versionId: ids.version } });
    await prisma.announcementVersion.delete({ where: { id: ids.version } });
    await prisma.announcement.delete({ where: { id: ids.announcement } });
  }
  await prisma.$disconnect();
});

async function login(page: import("@playwright/test").Page, user: { phone: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("手机号").fill(user.phone);
  await page.getByLabel("密码", { exact: true }).fill(user.password);
  const [response] = await Promise.all([
    page.waitForResponse((candidate) => candidate.url().endsWith("/api/v2/auth/login") && candidate.request().method() === "POST"),
    page.getByRole("button", { name: "登录" }).click(),
  ]);
  expect(response.ok()).toBe(true);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "首页" })).toBeVisible();
}

test("normal member sees the fixed real-data home order and approved four-tab shell", async ({ page }) => {
  await login(page, e2eUsers.normal);
  await expect(page.getByText("问政策、查企业、找团员")).toBeVisible();
  await expect(page.getByRole("link", { name: "问政策" })).toHaveAttribute("href", "/resources/policies");
  await expect(page.getByRole("link", { name: "查企业" })).toHaveAttribute("href", "/resources/enterprises");
  await expect(page.getByRole("link", { name: "找团员" })).toHaveAttribute("href", "/resources/members");
  await expect(page.getByRole("heading", { name: "当前在宝" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "今日行程" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最新需求" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "全团概览" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /认领|接手/ })).toHaveCount(0);
  await expect(page.getByText(/天气|欢迎语/)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /消息，\d+ 条未读/ })).toBeVisible();

  const presenceSection = page.locator('section[aria-labelledby="presence-title"]');
  await expect(presenceSection.locator('[title*="·"]')).toHaveCount(5);
  await expect(presenceSection.getByText("+1")).toBeVisible();
  await expect(page.locator('section[aria-labelledby="trips-title"] > div').last().getByRole("link")).toHaveCount(3);
  await expect(page.locator('section[aria-labelledby="todos-title"] > div').last().getByRole("link")).toHaveCount(3);
  const demands = page.locator('section[aria-labelledby="demands-title"] > div').last().getByRole("link");
  await expect(demands).toHaveCount(3);
  await expect(demands.first()).toContainText(recommendedDemandTitle);
  await expect(demands.first()).toContainText("为你推荐");

  const sectionOrder = await page.locator("main section").evaluateAll((sections) => sections.map((section) => section.getAttribute("aria-labelledby")));
  expect(sectionOrder).toEqual(["haobao-title", "announcement-title", "presence-title", "trips-title", "todos-title", "demands-title"]);

  const navigation = page.getByRole("navigation", { name: "手机主导航" });
  await expect(navigation.getByRole("link")).toHaveText(["首页", "需求", "资源", "我的"]);
});

for (const [name, fixture, shouldSeeTeam] of [
  ["group leader", e2eUsers.groupLeader, true],
  ["minister", e2eUsers.minister, true],
  ["township staff", e2eUsers.township, false],
  ["administrator", e2eUsers.admin, false],
  ["alumni", e2eUsers.alumni, false],
] as const) {
  test(`${name} gets the correct team-overview visibility`, async ({ page }) => {
    await login(page, fixture);
    const heading = page.getByRole("heading", { name: "全团概览" });
    if (shouldSeeTeam) await expect(heading).toBeVisible();
    else await expect(heading).toHaveCount(0);
  });
}
