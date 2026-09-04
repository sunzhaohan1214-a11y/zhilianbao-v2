import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { SESSION_COOKIE } from "@/lib/auth/cookies";
import { formalDemandPageAccess } from "@/lib/demand/formal-page-access";
import { getCurrentSessionByToken } from "@/modules/identity/session-service";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import { FormalDemandService } from "@/modules/demand";
import { DemandParticipationNotificationHandler } from "@/modules/outbox/handlers/demand-participation-notification-handler";
import { OutboxHandlerRegistry } from "@/modules/outbox/outbox-handler-registry";
import { enterpriseE2e, e2eUsers, seedAuthFixtures } from "./auth-fixtures";
import { e2eOrigin } from "./test-origin";

test.describe.configure({ mode: "serial" });
test.setTimeout(180_000);

async function login(browser: Browser, user: { phone: string; password: string }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const response = await page.request.post("/api/v2/auth/login", {
    headers: { origin: e2eOrigin },
    data: { phone: user.phone, password: user.password },
  });
  expect(response.status()).toBe(200);
  await page.goto("/");
  return { context, page };
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

async function deliverDemandParticipationEvents(demandId: string) {
  const prisma = getPrismaClient();
  const registry = new OutboxHandlerRegistry();
  for (const eventType of ["DEMAND_CLAIMED", "COLLABORATION_APPLIED", "COLLABORATION_INVITED", "COLLABORATION_APPROVED", "COLLABORATION_ACCEPTED", "COLLABORATOR_LEFT", "COLLABORATOR_REMOVED"] as const) {
    registry.register(eventType, new DemandParticipationNotificationHandler(eventType));
  }
  await prisma.$transaction(async (tx) => {
    const events = await tx.outboxEvent.findMany({
      where: { aggregateId: demandId, publishedAt: null, eventType: { in: ["DEMAND_CLAIMED", "COLLABORATION_APPLIED", "COLLABORATION_INVITED", "COLLABORATION_APPROVED", "COLLABORATION_ACCEPTED", "COLLABORATOR_LEFT", "COLLABORATOR_REMOVED"] } },
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
    });
    for (const event of events) {
      await registry.dispatch(event, tx);
      await tx.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date(), lastError: null, nextAttemptAt: null } });
    }
  });
}

function demandPayload(title: string, attachmentIds: string[] = [], sourceType: "TOWNSHIP_DIRECT" | "ADMIN_DIRECT" = "TOWNSHIP_DIRECT") {
  return {
    sourceType,
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

test("formal demand publish, claim, collaborate and ADMIN_DIRECT paths preserve every M1 boundary", async ({ browser }) => {
  const prisma = getPrismaClient();
  const suffix = randomUUID().slice(0, 8);
  const removableName = `formal-e2e-remove-${suffix}.pdf`;
  const retainedName = `formal-e2e-retain-${suffix}.pdf`;
  const createAttachment = (originalFilename: string) => prisma.attachment.create({ data: {
    originalFilename,
    extension: "pdf",
    declaredMimeType: "application/pdf",
    expectedSizeBytes: BigInt(18),
    actualSizeBytes: BigInt(18),
    bucket: "test-private-bucket",
    region: "ap-test",
    objectKey: `formal-e2e/${randomUUID()}.pdf`,
    uploadStatus: "UPLOADED" as const,
    scanStatus: "PASSED" as const,
    isTemporary: true,
    uploadedByPersonId: e2eUsers.admin.personId,
  } });
  const [removableAttachment, retainedAttachment] = await Promise.all([
    createAttachment(removableName), createAttachment(retainedName),
  ]);

  let authenticated = await login(browser, e2eUsers.admin);
  let page = authenticated.page;
  await page.goto("/demands/new");
  await expect(page.getByRole("heading", { name: "新建草稿" })).toBeVisible();
  const created = await post(page, "/api/v2/demands", demandPayload(
    `E2E 镇区正式需求 ${suffix}`,
    [removableAttachment.id, retainedAttachment.id],
    "TOWNSHIP_DIRECT",
  ));
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
  expect((await post(page, `/api/v2/demands/${demandId}/update-draft`, { attachmentIds: [] })).status).toBe(409);

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  await page.goto(`/admin/demands/${demandId}`);
  await expect(page.getByRole("heading", { name: "管理员审核" })).toBeVisible();
  await expect(page.getByLabel("标题", { exact: true })).toHaveCount(0);
  const coreMassAssignment = await post(page, `/api/v2/demands/${demandId}/review`, { decision: "APPROVE", title: "审核员越权修改核心" });
  expect(coreMassAssignment.status).toBe(400);
  await page.getByPlaceholder("退回原因（退回时必填）").fill("请补充量化目标和实施边界");
  await page.getByRole("button", { name: "退回修改" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  await expect(page.getByText("退回修改", { exact: true }).first()).toBeVisible();

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.township);
  page = authenticated.page;
  const sessionToken = (await authenticated.context.cookies()).find(({ name }) => name === SESSION_COOKIE)?.value;
  const session = await getCurrentSessionByToken(sessionToken);
  expect(session).not.toBeNull();
  const actor = await resolvePermissionActor(session!);
  const returnedDemand = await new FormalDemandService().detail({ actor, demandId });
  const returnedAccess = formalDemandPageAccess(actor, returnedDemand);
  expect({
    personId: actor.personId,
    roles: actor.effectiveRoles,
    townshipAreaIds: actor.townshipAreaIds,
    status: returnedDemand.status,
    responsibleAreaId: returnedDemand.responsibleAreaId,
    canEdit: returnedAccess.canEdit,
  }).toMatchObject({
    personId: e2eUsers.township.personId,
    roles: expect.arrayContaining(["TOWNSHIP_STAFF"]),
    townshipAreaIds: expect.arrayContaining([enterpriseE2e.areaAId]),
    status: "RETURNED",
    responsibleAreaId: enterpriseE2e.areaAId,
    canEdit: true,
  });
  await page.goto(`/demands/${demandId}`);
  await expect(page.getByText("请补充量化目标和实施边界").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "编辑草稿" })).toBeVisible();
  await page.getByRole("checkbox", { name: removableName }).uncheck();
  await page.locator('textarea[name="originalDescription"]').fill("E2E 退回后补充量化目标，但仍由原录入方修改核心字段。");
  await page.getByRole("button", { name: "保存草稿修改" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  expect(await prisma.attachmentLink.count({ where: {
    attachmentId: removableAttachment.id, entityType: "DEMAND", entityId: demandId, relationType: "FORMAL_ATTACHMENT",
  } })).toBe(0);
  expect(await prisma.attachment.findUniqueOrThrow({ where: { id: removableAttachment.id } })).toMatchObject({
    uploadedByPersonId: e2eUsers.admin.personId,
    isTemporary: true,
  });
  expect((await post(page, "/api/v2/demands", demandPayload(`E2E 越权来源 ${suffix}`, [], "ADMIN_DIRECT"))).status).toBe(403);
  await page.getByRole("button", { name: "提交审核" }).click();
  await expect(page.getByText("待审核", { exact: true })).toBeVisible();

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  await page.goto(`/admin/demands/${demandId}`);
  await page.locator('select[name="demandType"]').selectOption("TALENT");
  await page.locator('select[name="urgency"]').selectOption("URGENT");
  await page.getByRole("button", { name: "审核通过并立即发布" }).click();
  await expect(page.getByText("待对接", { exact: true })).toBeVisible();

  await page.goto("/admin/demands/new");
  await expect(page.getByRole("heading", { name: "管理员代录正式需求" })).toBeVisible();
  const adminDraft = await post(page, "/api/v2/demands", demandPayload(`E2E 管理员代录 ${suffix}`, [], "ADMIN_DIRECT"));
  expect(adminDraft.status).toBe(201);
  expect(adminDraft.payload.data.provenances).toEqual([expect.objectContaining({ sourceType: "ADMIN_DIRECT" })]);
  const adminDraftId = adminDraft.payload.data.id as string;

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.township);
  page = authenticated.page;
  expect((await post(page, `/api/v2/demands/${adminDraftId}/direct-publish`, {})).status).toBe(403);
  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.normal);
  page = authenticated.page;
  expect((await post(page, `/api/v2/demands/${adminDraftId}/direct-publish`, {})).status).toBe(403);
  const visibility = await page.evaluate(async ({ demandId, unpublishedId }) => ({
    published: (await fetch(`/api/v2/demands/${demandId}`)).status,
    unpublished: (await fetch(`/api/v2/demands/${unpublishedId}`)).status,
  }), { demandId, unpublishedId });
  expect(visibility).toEqual({ published: 200, unpublished: 404 });
  await page.goto("/demands");
  await page.getByRole("link", { name: new RegExp(`E2E 已修改核心标题 ${suffix}`) }).click();
  await expect(page.getByText("13800003001")).toBeVisible();
  await expect(page.getByText(retainedName)).toBeVisible();
  await expect(page.getByText(removableName)).toHaveCount(0);
  await page.getByRole("button", { name: "我要对接" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  await expect(page.getByText("对接中", { exact: true })).toBeVisible();
  await expect(page.getByText("当前负责人：E2E normal", { exact: true })).toBeVisible();
  await deliverDemandParticipationEvents(demandId);
  expect(await prisma.message.count({ where: { personId: e2eUsers.township.personId, aggregateId: demandId, messageType: "DEMAND_CLAIMED", title: "需求已被认领" } })).toBe(1);
  expect(await prisma.todo.count({ where: { aggregateId: demandId, todoType: { startsWith: "DEMAND_CLAIM" } } })).toBe(0);

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.groupLeader);
  page = authenticated.page;
  await page.goto(`/demands/${demandId}`);
  const losingClaim = await post(page, `/api/v2/demands/${demandId}/claim`, {}, { "Idempotency-Key": `loser-${suffix}` });
  expect(losingClaim).toMatchObject({ status: 409, payload: { error: { code: "DEMAND_ALREADY_CLAIMED" } } });
  await page.getByRole("button", { name: "申请协同" }).click();
  await expect(page.getByText("协同申请待主责确认", { exact: true })).toBeVisible();
  await deliverDemandParticipationEvents(demandId);
  const application = await prisma.demandCollaborationRequest.findFirstOrThrow({ where: { demandId, personId: e2eUsers.groupLeader.personId, requestType: "APPLY" } });
  expect(await prisma.todo.findFirstOrThrow({ where: { personId: e2eUsers.normal.personId, eventKey: application.id } })).toMatchObject({ todoType: "COLLABORATION_REVIEW", status: "OPEN" });

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.normal);
  page = authenticated.page;
  await page.goto(`/demands/${demandId}`);
  await expect(page.getByText("E2E groupLeader", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "同意协同" }).click();
  await expect(page.getByText("协同人：E2E groupLeader", { exact: true })).toBeVisible();
  await deliverDemandParticipationEvents(demandId);
  expect(await prisma.todo.findFirstOrThrow({ where: { personId: e2eUsers.normal.personId, eventKey: application.id } })).toMatchObject({ status: "STALE" });
  expect(await prisma.message.count({ where: { personId: e2eUsers.groupLeader.personId, aggregateId: demandId, messageType: "COLLABORATION_APPROVED" } })).toBe(1);
  await page.getByLabel("按姓名搜索协同人").fill("E2E minister");
  await expect(page.getByText("E2E minister", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "发出邀请" }).click();
  await expect(page.getByRole("status")).toHaveText("操作已完成。");
  await deliverDemandParticipationEvents(demandId);
  const invitation = await prisma.demandCollaborationRequest.findFirstOrThrow({ where: { demandId, personId: e2eUsers.minister.personId, requestType: "INVITE" } });
  expect(await prisma.todo.findFirstOrThrow({ where: { personId: e2eUsers.minister.personId, eventKey: invitation.id } })).toMatchObject({ todoType: "COLLABORATION_INVITE_RESPONSE", status: "OPEN" });

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.minister);
  page = authenticated.page;
  await page.goto(`/demands/${demandId}`);
  await page.getByRole("button", { name: "接受协同邀请" }).click();
  await expect(page.getByText("协同中", { exact: true })).toBeVisible();
  await deliverDemandParticipationEvents(demandId);
  expect(await prisma.todo.findFirstOrThrow({ where: { personId: e2eUsers.minister.personId, eventKey: invitation.id } })).toMatchObject({ status: "STALE" });
  expect(await prisma.message.count({ where: { personId: e2eUsers.normal.personId, aggregateId: demandId, messageType: "COLLABORATION_ACCEPTED" } })).toBe(1);
  await expect(page.getByText(/AI推荐|匹配理由|匹配度|愿意协助|暂不参与/)).toHaveCount(0);

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.groupLeader);
  page = authenticated.page;
  await page.goto(`/demands/${demandId}`);
  expect((await post(page, `/api/v2/demands/${demandId}/collaboration/leave`, { reason: "E2E 阶段任务完成" })).status).toBe(200);
  await deliverDemandParticipationEvents(demandId);
  expect(await prisma.message.count({ where: { personId: e2eUsers.normal.personId, aggregateId: demandId, messageType: "COLLABORATOR_LEFT" } })).toBe(1);
  await page.goto("/demands?mine=true");
  await expect(page.getByRole("link", { name: new RegExp(`E2E 已修改核心标题 ${suffix}`) })).toHaveCount(0);

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.normal);
  page = authenticated.page;
  await page.goto(`/demands/${demandId}`);
  expect((await post(page, `/api/v2/demands/${demandId}/collaboration/${e2eUsers.minister.personId}/remove`, { reason: "E2E 调整协同分工" })).status).toBe(200);
  await deliverDemandParticipationEvents(demandId);
  expect(await prisma.message.count({ where: { personId: e2eUsers.minister.personId, aggregateId: demandId, messageType: "COLLABORATOR_REMOVED" } })).toBe(1);
  await page.goto("/demands?mine=true");
  await expect(page.getByRole("link", { name: new RegExp(`E2E 已修改核心标题 ${suffix}`) })).toBeVisible();

  const collaborationHistory = await prisma.demandCollaborator.findMany({ where: { demandId }, select: { personId: true, status: true, expiredAt: true, endedReason: true } });
  expect(collaborationHistory).toEqual(expect.arrayContaining([
    expect.objectContaining({ personId: e2eUsers.groupLeader.personId, status: "LEFT", expiredAt: expect.any(Date), endedReason: "E2E 阶段任务完成" }),
    expect.objectContaining({ personId: e2eUsers.minister.personId, status: "REMOVED", expiredAt: expect.any(Date), endedReason: "E2E 调整协同分工" }),
  ]));

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.minister);
  page = authenticated.page;
  await page.goto("/demands?mine=true");
  await expect(page.getByRole("link", { name: new RegExp(`E2E 已修改核心标题 ${suffix}`) })).toHaveCount(0);

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.admin);
  page = authenticated.page;
  const directPublished = await post(page, `/api/v2/demands/${adminDraftId}/direct-publish`, {});
  expect(directPublished.status).toBe(200);
  expect(directPublished.payload.data).toMatchObject({ status: "PENDING_CLAIM", firstPublishedAt: expect.any(String) });
  const ministerOnlyDraft = await post(page, "/api/v2/demands", demandPayload(`E2E 部长单角色拒绝 ${suffix}`, [], "ADMIN_DIRECT"));
  expect(ministerOnlyDraft.status).toBe(201);
  const ministerOnlyDemandId = ministerOnlyDraft.payload.data.id as string;
  expect((await post(page, `/api/v2/demands/${ministerOnlyDemandId}/direct-publish`, {})).status).toBe(200);
  await page.goto(`/admin/demands/${adminDraftId}`);
  await expect(page.getByText("待对接", { exact: true })).toBeVisible();

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.alumni);
  page = authenticated.page;
  await page.goto(`/demands/${ministerOnlyDemandId}`);
  await expect(page.getByRole("button", { name: "我要对接" })).toHaveCount(0);
  expect((await post(page, `/api/v2/demands/${ministerOnlyDemandId}/claim`, {}, { "Idempotency-Key": `alumni-${suffix}` })).status).toBe(403);

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.minister);
  page = authenticated.page;
  await page.goto(`/demands/${adminDraftId}`);
  expect((await post(page, `/api/v2/demands/${adminDraftId}/claim`, {}, { "Idempotency-Key": `minister-member-${suffix}` })).status).toBe(200);
  await prisma.roleAssignment.updateMany({ where: { personId: e2eUsers.minister.personId, roleCode: "MEMBER_CURRENT", expiredAt: null }, data: { expiredAt: new Date() } });

  await authenticated.context.close();
  authenticated = await login(browser, e2eUsers.minister);
  page = authenticated.page;
  await page.goto(`/demands/${ministerOnlyDemandId}`);
  await expect(page.getByRole("button", { name: "我要对接" })).toHaveCount(0);
  expect((await post(page, `/api/v2/demands/${ministerOnlyDemandId}/claim`, {}, { "Idempotency-Key": `minister-only-${suffix}` })).status).toBe(403);
  expect(await prisma.outboxEvent.count({ where: { aggregateId: demandId, publishedAt: { not: null } } })).toBeGreaterThanOrEqual(7);
  await authenticated.context.close();
});

test("mobile demand filters submit and preserve the mine scope", async ({ browser }) => {
  const suffix = randomUUID().slice(0, 8);
  const targetTitle = `E2E 我的筛选目标 ${suffix}`;
  const otherTitle = `E2E 我的筛选排除 ${suffix}`;

  let authenticated = await login(browser, e2eUsers.admin);
  const createAndPublish = async (title: string) => {
    const created = await post(authenticated.page, "/api/v2/demands", demandPayload(title, [], "ADMIN_DIRECT"));
    expect(created.status).toBe(201);
    const demandId = created.payload.data.id as string;
    expect((await post(authenticated.page, `/api/v2/demands/${demandId}/direct-publish`, {})).status).toBe(200);
    return demandId;
  };
  const targetId = await createAndPublish(targetTitle);
  const otherId = await createAndPublish(otherTitle);
  await authenticated.context.close();

  authenticated = await login(browser, e2eUsers.normal);
  expect((await post(authenticated.page, `/api/v2/demands/${targetId}/claim`, {}, { "Idempotency-Key": `filter-target-${suffix}` })).status).toBe(200);
  expect((await post(authenticated.page, `/api/v2/demands/${otherId}/claim`, {}, { "Idempotency-Key": `filter-other-${suffix}` })).status).toBe(200);
  await authenticated.page.goto("/demands?mine=true");
  await expect(authenticated.page.getByRole("link", { name: new RegExp(targetTitle) })).toBeVisible();
  await expect(authenticated.page.getByRole("link", { name: new RegExp(otherTitle) })).toBeVisible();

  await authenticated.page.getByLabel("搜索需求").fill(targetTitle);
  await authenticated.page.getByLabel("需求状态").selectOption("IN_PROGRESS");
  await authenticated.page.getByRole("button", { name: "查询" }).click();

  await expect.poll(() => {
    const query = new URL(authenticated.page.url()).searchParams;
    return { keyword: query.get("keyword"), mine: query.get("mine"), status: query.get("status") };
  }).toEqual({ keyword: targetTitle, mine: "true", status: "IN_PROGRESS" });
  await expect(authenticated.page.getByRole("link", { name: new RegExp(targetTitle) })).toBeVisible();
  await expect(authenticated.page.getByRole("link", { name: new RegExp(otherTitle) })).toHaveCount(0);
  await authenticated.context.close();
});
