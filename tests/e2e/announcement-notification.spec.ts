import { expect, test, type Page } from "@playwright/test";
import { getPrismaClient } from "@/lib/db/prisma";
import { AnnouncementNotificationHandler } from "@/modules/outbox/handlers/announcement-notification-handler";
import { OutboxHandlerRegistry } from "@/modules/outbox/outbox-handler-registry";
import { e2eUsers, seedAuthFixtures } from "./auth-fixtures";

test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);
async function login(page: Page, user: { phone: string; password: string }) { await page.goto("/login"); await page.getByLabel("手机号").fill(user.phone); await page.getByLabel("密码", { exact: true }).fill(user.password); await Promise.all([page.waitForResponse((r) => r.url().endsWith("/api/v2/auth/login")), page.getByRole("button", { name: "登录" }).click()]); }
async function api(page: Page, url: string, body?: unknown) { return page.evaluate(async ({ url, body }) => { const response = await fetch(url, { method: body === undefined ? "GET" : "POST", headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: response.status, json: await response.json() }; }, { url, body }); }
async function dispatch(id: string, twice = false) { const prisma=getPrismaClient();const registry=new OutboxHandlerRegistry();for(const type of ["ANNOUNCEMENT_PUBLISHED","ANNOUNCEMENT_UPDATED","ANNOUNCEMENT_AUDIENCE_ADDED","ANNOUNCEMENT_AUDIENCE_REMOVED","ANNOUNCEMENT_WITHDRAWN"] as const)registry.register(type,new AnnouncementNotificationHandler(type));const events=await prisma.outboxEvent.findMany({where:{aggregateType:"ANNOUNCEMENT",aggregateId:id,publishedAt:null},orderBy:{occurredAt:"asc"}});for(const event of events){await prisma.$transaction(tx=>registry.dispatch(event,tx));if(twice)await prisma.$transaction(tx=>registry.dispatch(event,tx));await prisma.outboxEvent.update({where:{id:event.id},data:{publishedAt:new Date()}});}}
test.beforeEach(async()=>{await seedAuthFixtures();});

test("announcement governance, visibility, confirmation, message/todo and stale links",async({page})=>{
  const prisma=getPrismaClient();
  await login(page,e2eUsers.admin);
  const attachment=await prisma.attachment.create({data:{originalFilename:"公告附件.pdf",extension:"pdf",declaredMimeType:"application/pdf",expectedSizeBytes:BigInt(8),actualSizeBytes:BigInt(8),bucket:"test",region:"test",objectKey:`announcement-e2e/${crypto.randomUUID()}.pdf`,uploadStatus:"UPLOADED",scanStatus:"PASSED",isTemporary:true,uploadedByPersonId:e2eUsers.admin.personId}});
  const created=await api(page,"/api/v2/admin/announcements",{title:"E2E 重要公告",body:"第一版公告正文",isImportant:true,needConfirm:true,attachmentIds:[attachment.id],audience:[{type:"PERSON",personId:e2eUsers.normal.personId}]});
  expect(created.status).toBe(201);const id=created.json.data.id;
  expect((await api(page,`/api/v2/admin/announcements/${id}/publish`,{})).status).toBe(200);
  await dispatch(id,true);

  await page.context().clearCookies();await login(page,e2eUsers.normal);
  expect((await api(page,`/api/v2/announcements/${id}`)).status).toBe(200);
  expect((await api(page,`/api/v2/announcements/${id}/read`,{})).status).toBe(200);
  expect((await api(page,`/api/v2/announcements/${id}/confirm`,{})).status).toBe(200);
  const messages=await api(page,"/api/v2/messages");expect(messages.json.data.items.filter((x:{aggregateId:string})=>x.aggregateId===id)).toHaveLength(1);
  const todos=await api(page,"/api/v2/todos?module=ANNOUNCEMENT");expect(todos.json.data.items.filter((x:{aggregateId:string})=>x.aggregateId===id)).toHaveLength(0);
  expect((await api(page,"/api/v2/messages/read-all",{})).status).toBe(200);

  await page.context().clearCookies();await login(page,e2eUsers.alumni);
  expect((await api(page,`/api/v2/announcements/${id}`)).status).toBe(404);
  await page.context().clearCookies();await login(page,e2eUsers.admin);
  const status=await api(page,`/api/v2/admin/announcements/${id}/confirmation-status`);expect(status.json.data).toMatchObject({total:1,confirmed:1});
  expect((await api(page,`/api/v2/admin/announcements/${id}/update`,{title:"E2E 重要公告",body:"第二版公告正文",isImportant:true,needConfirm:true,attachmentIds:[attachment.id],reason:"E2E 更新版本"})).status).toBe(200);
  await dispatch(id,true);
  expect(await prisma.announcementVersion.count({where:{announcementId:id}})).toBe(2);
  expect((await api(page,`/api/v2/admin/announcements/${id}/audience`,{audience:[{type:"PERSON",personId:e2eUsers.alumni.personId}],reason:"E2E 切换接收人"})).status).toBe(200);
  await dispatch(id,true);

  await page.context().clearCookies();await login(page,e2eUsers.normal);
  expect((await api(page,`/api/v2/announcements/${id}`)).status).toBe(404);
  expect((await api(page,`/api/v2/attachments/${attachment.id}/access?action=preview`)).status).toBe(403);
  await page.context().clearCookies();await login(page,e2eUsers.alumni);
  expect((await api(page,`/api/v2/announcements/${id}`)).status).toBe(200);
  const openTodos=await api(page,"/api/v2/todos?module=ANNOUNCEMENT");expect(openTodos.json.data.items.filter((x:{aggregateId:string})=>x.aggregateId===id)).toHaveLength(1);
});
