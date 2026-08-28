import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { registerReimbursementAttachmentAuthorizers } from "@/modules/reimbursement/attachment-authorizer";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import { ReimbursementService } from "@/modules/reimbursement/reimbursement-service";
import { ReimbursementNotificationHandler, type ReimbursementEventType } from "@/modules/outbox/handlers/reimbursement-notification-handler";
import { OutboxHandlerRegistry } from "@/modules/outbox/outbox-handler-registry";
import { activeReimbursementManagers } from "@/modules/reimbursement/active-reimbursement-managers";

const prisma = getPrismaClient(); const service = new ReimbursementService();
const people: string[] = []; const accounts: string[] = []; const attachments: string[] = []; const trips: string[] = [];
let applicant: PermissionActor; let outsider: PermissionActor; let minister: PermissionActor; let admin: PermissionActor; let manager: PermissionActor;
let managerOnly: PermissionActor; let groupLeader: PermissionActor; let township: PermissionActor; let department: PermissionActor; let alumniGranted: PermissionActor; let alumniUngrant: PermissionActor; let completedTripId: string;

async function actor(role: RoleCode, special: string[] = [], currentBatchMember = false) {
  const person = await prisma.person.create({ data: { name: `Reimbursement ${role} ${randomUUID()}` } }); people.push(person.id);
  const account = await prisma.account.create({ data: { personId: person.id, phone: `135${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, passwordHash: "test", status: "NORMAL" } }); accounts.push(account.id);
  const permissions = new Set(special); const roles = [role];
  return { personId: person.id, accountId: account.id, accountStatus: "NORMAL" as const, permissionVersion: BigInt(1), effectiveRoles: roles,
    capabilities: resolveCapabilities(roles, permissions), specialPermissions: permissions, selfPersonId: person.id, townshipAreaIds: [], departmentAreaIds: [],
    hasGlobalPublished: true, hasGlobalOperational: role === "ADMIN" || role === "SUPER_ADMIN", hasSystem: role === "SUPER_ADMIN", currentBatchMember, configurationIssues: [] } satisfies PermissionActor;
}

const travelBody = (reason = "赴外招商差旅") => ({ type: "TRAVEL" as const, reason, linkedTripId: completedTripId,
  expenses: [{ expenseType: "TRAVEL_TRANSPORT_ACTUAL" as const, amount: "188.50", source: "MANUAL" as const },
    { expenseType: "TRAVEL_MEAL_SUBSIDY" as const, amount: "200.00", source: "MANUAL" as const, referenceRate: "100", claimedDays: "2" }] });

async function addInvoice(itemId: string, status: "NOT_REQUESTED" | "READY" | "DEGRADED" | "FAILED" | "CONFIRMED" = "NOT_REQUESTED") {
  const attachment = await prisma.attachment.create({ data: { originalFilename: `remove-${randomUUID()}.pdf`, extension: "pdf", declaredMimeType: "application/pdf", expectedSizeBytes: BigInt(8), actualSizeBytes: BigInt(8), bucket: "test", region: "test", objectKey: `reimbursement/${randomUUID()}.pdf`, uploadStatus: "UPLOADED", scanStatus: "PASSED", isTemporary: true, uploadedByPersonId: applicant.personId } });
  attachments.push(attachment.id);
  const invoice = await service.addInvoice({ actor: applicant, reimbursementId: itemId, body: { attachmentId: attachment.id } });
  if (status === "CONFIRMED") {
    await service.confirmInvoice({ actor: applicant, reimbursementId: itemId, invoiceId: invoice.id, body: { expenseType: "TRAVEL_LODGING", amount: "88.00", invoiceNo: `REMOVE-${randomUUID()}` } });
  } else if (status !== "NOT_REQUESTED") {
    await prisma.reimbursementInvoice.update({ where: { id: invoice.id }, data: { ocrStatus: status } });
  }
  return { attachment, invoice };
}

const reimbursementEvents = ["REIMBURSEMENT_SUBMITTED", "REIMBURSEMENT_RETURNED", "REIMBURSEMENT_VERIFIED", "REIMBURSEMENT_PAPER_RECEIVED", "REIMBURSEMENT_PAPER_INCOMPLETE", "REIMBURSEMENT_FINANCE_SUBMITTED", "REIMBURSEMENT_WITHDRAWN", "REIMBURSEMENT_STATE_CORRECTED"] as const satisfies readonly ReimbursementEventType[];
async function dispatchReimbursementEvents(reimbursementId: string, replay = false) {
  const registry = new OutboxHandlerRegistry();
  for (const eventType of reimbursementEvents) registry.register(eventType, new ReimbursementNotificationHandler(eventType));
  const events = await prisma.outboxEvent.findMany({ where: { aggregateType: "REIMBURSEMENT", aggregateId: reimbursementId, publishedAt: null }, orderBy: { occurredAt: "asc" } });
  for (const event of events) {
    await prisma.$transaction((tx) => registry.dispatch(event, tx));
    if (replay) await prisma.$transaction((tx) => registry.dispatch(event, tx));
    await prisma.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: new Date() } });
  }
}

beforeAll(async () => {
  [applicant, outsider, minister, admin, manager, managerOnly, groupLeader, township, department, alumniGranted, alumniUngrant] = await Promise.all([
    actor("MEMBER_CURRENT", ["reimbursement.apply"], true), actor("MEMBER_CURRENT", ["reimbursement.apply"], true), actor("MINISTER"), actor("ADMIN"), actor("SUPER_ADMIN", ["reimbursement.manage"]),
    actor("MEMBER_ALUMNI_PLATFORM", ["reimbursement.manage"]), actor("GROUP_LEADER"), actor("TOWNSHIP_STAFF"), actor("DEPARTMENT_STAFF"), actor("MEMBER_ALUMNI_PLATFORM", ["reimbursement.apply"]), actor("MEMBER_ALUMNI_PLATFORM"),
  ]);
  await prisma.roleAssignment.create({ data: { personId: manager.personId, roleCode: "SUPER_ADMIN", effectiveAt: new Date(Date.now() - 60_000), reason: "reimbursement manager fixture" } });
  await prisma.roleAssignment.createMany({ data: [
    { personId: admin.personId, roleCode: "ADMIN", effectiveAt: new Date(Date.now() - 60_000), reason: "non-manager fixture" },
    { personId: minister.personId, roleCode: "MINISTER", effectiveAt: new Date(Date.now() - 60_000), reason: "non-manager fixture" },
  ] });
  await prisma.specialPermissionGrant.create({ data: { personId: managerOnly.personId, permissionCode: "reimbursement.manage", effectiveAt: new Date(Date.now() - 60_000), reason: "reimbursement manager fixture", grantedByPersonId: manager.personId } });
  const trip = await prisma.trip.create({ data: { title: "已完成招商行程", purpose: "企业拜访", overallEndAt: new Date(Date.now() - 86_400_000), createdByPersonId: applicant.personId,
    participants: { create: { personId: applicant.personId, isCreator: true, addedByPersonId: applicant.personId } },
    nodes: { create: { sequenceNo: 1, plannedStartAt: new Date(Date.now() - 172_800_000), plannedEndAt: new Date(Date.now() - 86_400_000), locationName: "上海", content: "企业拜访" } },
    result: { create: { resultSummary: "招商行程完成", submittedByPersonId: applicant.personId } } } });
  trips.push(trip.id); completedTripId = trip.id;
});

afterAll(async () => {
  const ids = (await prisma.reimbursement.findMany({ where: { applicantPersonId: { in: people } }, select: { id: true } })).map((x) => x.id);
  await prisma.todo.deleteMany({ where: { aggregateType: "REIMBURSEMENT", aggregateId: { in: ids } } });
  await prisma.message.deleteMany({ where: { aggregateType: "REIMBURSEMENT", aggregateId: { in: ids } } });
  await prisma.outboxEvent.deleteMany({ where: { aggregateType: "REIMBURSEMENT", aggregateId: { in: ids } } });
  await prisma.attachmentLink.deleteMany({ where: { entityType: { in: ["REIMBURSEMENT_INVOICE", "REIMBURSEMENT_EXPORT"] }, entityId: { in: ids } } });
  await prisma.reimbursementExportTask.deleteMany({ where: { createdByPersonId: { in: people } } });
  await prisma.jobTask.deleteMany({ where: { OR: [{ jobType: "REIMBURSEMENT_INVOICE_OCR" }, { jobType: "REIMBURSEMENT_EXPORT" }] } });
  await prisma.reimbursementCommandIdempotency.deleteMany({ where: { reimbursementId: { in: ids } } });
  await prisma.reimbursementExpense.deleteMany({ where: { reimbursementId: { in: ids } } });
  await prisma.reimbursementInvoice.deleteMany({ where: { reimbursementId: { in: ids } } });
  await prisma.reimbursement.updateMany({ where: { id: { in: ids } }, data: { currentSubmissionVersionId: null } });
  await prisma.reimbursementSubmissionVersion.deleteMany({ where: { reimbursementId: { in: ids } } });
  await prisma.reimbursement.deleteMany({ where: { id: { in: ids } } });
  await prisma.attachmentAccessLog.deleteMany({ where: { attachmentId: { in: attachments } } }); await prisma.attachment.deleteMany({ where: { id: { in: attachments } } });
  await prisma.stateTransitionHistory.deleteMany({ where: { entityType: "REIMBURSEMENT", actorPersonId: { in: people } } });
  await prisma.auditLog.deleteMany({ where: { entityType: "REIMBURSEMENT", actorPersonId: { in: people } } });
  await prisma.tripResult.deleteMany({ where: { tripId: { in: trips } } }); await prisma.tripNode.deleteMany({ where: { tripId: { in: trips } } }); await prisma.tripParticipant.deleteMany({ where: { tripId: { in: trips } } }); await prisma.trip.deleteMany({ where: { id: { in: trips } } });
  await prisma.specialPermissionGrant.deleteMany({ where: { personId: { in: people } } }); await prisma.roleAssignment.deleteMany({ where: { personId: { in: people } } });
  await prisma.account.deleteMany({ where: { id: { in: accounts } } }); await prisma.person.deleteMany({ where: { id: { in: people } } }); await prisma.$disconnect();
});

describe("B-M3-001 real MySQL reimbursement workflow", () => {
  it("resolves only active reimbursement.manage grantees and effective SUPER_ADMIN actors", async () => {
    const ids = await prisma.$transaction((tx) => activeReimbursementManagers(tx));
    expect(ids).toEqual(expect.arrayContaining([manager.personId, managerOnly.personId]));
    expect(ids).not.toEqual(expect.arrayContaining([admin.personId, minister.personId]));
  });

  it("allocates unique Shanghai-year BX numbers under concurrency", async () => {
    const items = await Promise.all(Array.from({ length: 20 }, (_, i) => service.create({ actor: applicant, body: travelBody(`并发报销 ${i}`) })));
    expect(new Set(items.map((item) => item?.businessNo)).size).toBe(20); for (const item of items) expect(item?.businessNo).toMatch(/^BX-\d{4}-\d{6}$/);
  });

  it("keeps detail, lists and attachments private from admin, minister and unrelated members", async () => {
    const item = await service.create({ actor: applicant, body: travelBody() }); if (!item) throw new Error("fixture");
    for (const blocked of [outsider, minister, groupLeader, township, department, admin]) await expect(service.detail({ actor: blocked, reimbursementId: item.id })).rejects.toMatchObject({ code: "REIMBURSEMENT_NOT_FOUND" });
    await expect(service.detail({ actor: managerOnly, reimbursementId: item.id })).resolves.toMatchObject({ id: item.id }); await expect(service.detail({ actor: manager, reimbursementId: item.id })).resolves.toMatchObject({ id: item.id });
    const registry = new AttachmentParentAuthorizerRegistry(); registerReimbursementAttachmentAuthorizers(registry);
    const link = { entityType: "REIMBURSEMENT_INVOICE", entityId: item.id, relationType: "INVOICE" };
    await expect(registry.authorizeAll({ actor: applicant, links: [link], action: "PREVIEW" })).resolves.toBe(true);
    await expect(registry.authorizeAll({ actor: managerOnly, links: [link], action: "PREVIEW" })).resolves.toBe(true);
    await expect(registry.authorizeAll({ actor: manager, links: [link], action: "DOWNLOAD" })).resolves.toBe(true);
    await expect(registry.authorizeAll({ actor: admin, links: [link], action: "PREVIEW" })).resolves.toBe(false);
    for (const blocked of [outsider, minister, groupLeader, township, department]) await expect(registry.authorizeAll({ actor: blocked, links: [link], action: "PREVIEW" })).resolves.toBe(false);
  });

  it("allows a specially granted alumni applicant but not an ungranted alumni applicant", async () => {
    await expect(service.create({ actor: alumniGranted, body: { ...travelBody("往届专项报销"), linkedTripId: null } })).resolves.toMatchObject({ applicantPersonId: alumniGranted.personId, status: "DRAFT" });
    await expect(service.create({ actor: alumniUngrant, body: { ...travelBody("未授权往届报销"), linkedTripId: null } })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
  });

  it("creates immutable versions on every submission and tracks only material flow states", async () => {
    const item = await service.create({ actor: applicant, body: travelBody("第一版") }); if (!item) throw new Error("fixture");
    await service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: `submit-${randomUUID()}` });
    const firstVersion = await prisma.reimbursementSubmissionVersion.findFirstOrThrow({ where: { reimbursementId: item.id, versionNo: 1 } });
    const originalTripSnapshot = firstVersion.tripSnapshotJson as { title: string; participants: Array<{ person: { name: string } }>; nodes: Array<{ content: string }> };
    await prisma.trip.update({ where: { id: completedTripId }, data: { title: "提交后修改的实时行程" } });
    expect((await prisma.reimbursementSubmissionVersion.findUniqueOrThrow({ where: { id: firstVersion.id } })).tripSnapshotJson).toEqual(originalTripSnapshot);
    expect(originalTripSnapshot.participants[0].person.name).toBeTruthy(); expect(originalTripSnapshot.nodes[0].content).toBe("企业拜访");
    await prisma.trip.update({ where: { id: completedTripId }, data: { title: "已完成招商行程" } });
    await service.returnForRevision({ actor: manager, reimbursementId: item.id, body: { reason: "补充说明" } });
    await service.update({ actor: applicant, reimbursementId: item.id, body: travelBody("第二版") });
    await service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: `submit-${randomUUID()}` });
    expect(await prisma.reimbursementSubmissionVersion.count({ where: { reimbursementId: item.id } })).toBe(2);
    await service.verify({ actor: manager, reimbursementId: item.id }); await expect(service.returnForRevision({ actor: manager, reimbursementId: item.id, body: { reason: "核对后仍需修改" } })).resolves.toMatchObject({ status: "RETURNED" });
    await service.update({ actor: applicant, reimbursementId: item.id, body: travelBody("第三版") }); await service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: `submit-${randomUUID()}` });
    await service.verify({ actor: manager, reimbursementId: item.id }); await service.paperReceived({ actor: manager, reimbursementId: item.id });
    await service.paperIncomplete({ actor: manager, reimbursementId: item.id, body: { reason: "缺少签字" } }); await service.paperReceived({ actor: manager, reimbursementId: item.id });
    const final = await service.financeSubmitted({ actor: manager, reimbursementId: item.id }); expect(final?.status).toBe("FINANCE_SUBMITTED");
    expect(await prisma.reimbursementSubmissionVersion.count({ where: { reimbursementId: item.id } })).toBe(3);
    expect(await prisma.stateTransitionHistory.count({ where: { entityType: "REIMBURSEMENT", entityId: item.id } })).toBeGreaterThanOrEqual(12);
    expect(await prisma.outboxEvent.count({ where: { aggregateType: "REIMBURSEMENT", aggregateId: item.id } })).toBeGreaterThanOrEqual(10);
  });

  it("serializes concurrent submit and replays one key without a second version", async () => {
    const item = await service.create({ actor: applicant, body: travelBody() }); if (!item) throw new Error("fixture"); const key = `same-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 10 }, () => service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: key })));
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    expect(await prisma.reimbursementSubmissionVersion.count({ where: { reimbursementId: item.id } })).toBe(1);
    expect(await prisma.stateTransitionHistory.count({ where: { entityType: "REIMBURSEMENT", entityId: item.id, actionCode: "REIMBURSEMENT_SUBMITTED" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: "REIMBURSEMENT", entityId: item.id, actionCode: "REIMBURSEMENT_SUBMITTED" } })).toBe(1);
  });

  it("returns one stable conflict and rolls back the loser when one key crosses reimbursements", async () => {
    const [first, second] = await Promise.all([service.create({ actor: applicant, body: travelBody("甲") }), service.create({ actor: applicant, body: travelBody("乙") })]); if (!first || !second) throw new Error("fixture"); const key = `cross-${randomUUID()}`;
    const settled = await Promise.allSettled([service.submit({ actor: applicant, reimbursementId: first.id, idempotencyKey: key }), service.submit({ actor: applicant, reimbursementId: second.id, idempotencyKey: key })]);
    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(settled.find((result) => result.status === "rejected")).toMatchObject({ reason: { code: "REIMBURSEMENT_IDEMPOTENCY_CONFLICT", status: 409 } });
    const loserId = settled[0].status === "rejected" ? first.id : second.id;
    expect(await prisma.reimbursement.findUniqueOrThrow({ where: { id: loserId } })).toMatchObject({ status: "DRAFT", currentSubmissionVersionId: null });
    expect(await prisma.reimbursementSubmissionVersion.count({ where: { reimbursementId: loserId } })).toBe(0);
    expect(await prisma.stateTransitionHistory.count({ where: { entityType: "REIMBURSEMENT", entityId: loserId, actionCode: "REIMBURSEMENT_SUBMITTED" } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityType: "REIMBURSEMENT", entityId: loserId, actionCode: "REIMBURSEMENT_SUBMITTED" } })).toBe(0);
  });

  it("rejects a duplicate confirmed invoice number across submitted reimbursements without leaking the other record", async () => {
    async function withInvoice(reason: string) { const item = await service.create({ actor: applicant, body: travelBody(reason) }); if (!item) throw new Error("fixture");
      const attachment = await prisma.attachment.create({ data: { originalFilename: `${reason}.pdf`, extension: "pdf", declaredMimeType: "application/pdf", expectedSizeBytes: BigInt(8), actualSizeBytes: BigInt(8), bucket: "test", region: "test", objectKey: `reimbursement/${randomUUID()}.pdf`, uploadStatus: "UPLOADED", scanStatus: "PASSED", isTemporary: false, uploadedByPersonId: applicant.personId } }); attachments.push(attachment.id);
      await prisma.reimbursementInvoice.create({ data: { reimbursementId: item.id, attachmentId: attachment.id, ocrStatus: "CONFIRMED", confirmedExpenseType: "TRAVEL_TRANSPORT_ACTUAL", confirmedInvoiceNo: "INV-001", invoiceNoNormalized: "INV001", confirmedAt: new Date(), confirmedByPersonId: applicant.personId } }); return item; }
    const first = await withInvoice("重复甲"); const second = await withInvoice("重复乙"); await service.submit({ actor: applicant, reimbursementId: first.id, idempotencyKey: `invoice-${randomUUID()}` });
    await expect(service.submit({ actor: applicant, reimbursementId: second.id, idempotencyKey: `invoice-${randomUUID()}` })).rejects.toMatchObject({ code: "REIMBURSEMENT_DUPLICATE_INVOICE", status: 409 });
  });

  it("removes failed-scan invoices safely and leaves the attachment temporary without deleting its object", async () => {
    const item = await service.create({ actor: applicant, body: travelBody("失败票据移除") }); if (!item) throw new Error("fixture");
    const { attachment, invoice } = await addInvoice(item.id, "FAILED");
    await prisma.attachment.update({ where: { id: attachment.id }, data: { scanStatus: "FAILED", scanReason: "test rejection" } });
    await expect(service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: `blocked-${randomUUID()}` })).rejects.toMatchObject({ code: "REIMBURSEMENT_INVOICE_INVALID" });
    await expect(service.removeInvoice({ actor: applicant, reimbursementId: item.id, invoiceId: invoice.id })).resolves.toMatchObject({ removed: true, invoiceId: invoice.id, attachmentId: attachment.id });
    expect(await prisma.reimbursementInvoice.findUnique({ where: { id: invoice.id } })).toBeNull();
    expect(await prisma.attachmentLink.count({ where: { attachmentId: attachment.id } })).toBe(0);
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: attachment.id } })).toMatchObject({ isTemporary: true, objectKey: attachment.objectKey, permissionLevel: "SENSITIVE_PARENT" });
    await expect(service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: `after-remove-${randomUUID()}` })).resolves.toMatchObject({ status: "PENDING_ONLINE_REVIEW" });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "REIMBURSEMENT", entityId: item.id, actionCode: "REIMBURSEMENT_INVOICE_REMOVED" } });
    expect(audit.afterJson).toEqual({ invoiceId: invoice.id, attachmentId: attachment.id });
  });

  it("rejects removal while an active expense uses the invoice and nulls only inactive historical references", async () => {
    const item = await service.create({ actor: applicant, body: travelBody("活动费用引用") }); if (!item) throw new Error("fixture");
    const { attachment, invoice } = await addInvoice(item.id);
    await service.update({ actor: applicant, reimbursementId: item.id, body: { ...travelBody("活动费用引用"), expenses: [{ expenseType: "TRAVEL_TRANSPORT_ACTUAL", amount: "88.00", source: "MANUAL", invoiceId: invoice.id }] } });
    await expect(service.removeInvoice({ actor: applicant, reimbursementId: item.id, invoiceId: invoice.id })).rejects.toMatchObject({ code: "REIMBURSEMENT_INVOICE_IN_USE", status: 409, message: "请先移除或修改引用该票据的费用明细" });
    expect(await prisma.reimbursementInvoice.findUnique({ where: { id: invoice.id } })).not.toBeNull();
    expect(await prisma.attachmentLink.count({ where: { attachmentId: attachment.id } })).toBe(1);
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: attachment.id } })).toMatchObject({ isTemporary: false });
    await service.update({ actor: applicant, reimbursementId: item.id, body: travelBody("移除活动引用") });
    const historical = await prisma.reimbursementExpense.findFirstOrThrow({ where: { reimbursementId: item.id, invoiceId: invoice.id, isActive: false } });
    await service.removeInvoice({ actor: applicant, reimbursementId: item.id, invoiceId: invoice.id });
    expect(await prisma.reimbursementExpense.findUniqueOrThrow({ where: { id: historical.id } })).toMatchObject({ invoiceId: null, isActive: false });
  });

  it("keeps removal owner-only and editable-state-only with non-discoverable cross-person responses", async () => {
    const item = await service.create({ actor: applicant, body: travelBody("删除权限") }); if (!item) throw new Error("fixture");
    const { invoice } = await addInvoice(item.id);
    for (const blocked of [outsider, manager, admin, minister]) await expect(service.removeInvoice({ actor: blocked, reimbursementId: item.id, invoiceId: invoice.id })).rejects.toMatchObject({ code: "REIMBURSEMENT_NOT_FOUND", status: 404 });
    await service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: `formal-${randomUUID()}` });
    await expect(service.removeInvoice({ actor: applicant, reimbursementId: item.id, invoiceId: invoice.id })).rejects.toMatchObject({ code: "REIMBURSEMENT_STATE_CONFLICT", status: 409 });
    expect(await prisma.reimbursementInvoice.findUnique({ where: { id: invoice.id } })).not.toBeNull();
  });

  it("removes current material after return without mutating the immutable first submission snapshot", async () => {
    const item = await service.create({ actor: applicant, body: travelBody("退回票据") }); if (!item) throw new Error("fixture");
    const { invoice } = await addInvoice(item.id, "CONFIRMED");
    await service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: `returned-v1-${randomUUID()}` });
    const version = await prisma.reimbursementSubmissionVersion.findFirstOrThrow({ where: { reimbursementId: item.id, versionNo: 1 } });
    const snapshot = version.invoiceSnapshotJson;
    await service.returnForRevision({ actor: manager, reimbursementId: item.id, body: { reason: "移除错误票据" } });
    await service.removeInvoice({ actor: applicant, reimbursementId: item.id, invoiceId: invoice.id });
    expect((await prisma.reimbursementSubmissionVersion.findUniqueOrThrow({ where: { id: version.id } })).invoiceSnapshotJson).toEqual(snapshot);
    expect(await prisma.reimbursementInvoice.findUnique({ where: { id: invoice.id } })).toBeNull();
    await service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: `returned-v2-${randomUUID()}` });
    const second = await prisma.reimbursementSubmissionVersion.findFirstOrThrow({ where: { reimbursementId: item.id, versionNo: 2 } });
    expect(second.invoiceSnapshotJson).toEqual([]);
  });

  it("blocks invoice removal during queued and processing OCR without side effects", async () => {
    const item = await service.create({ actor: applicant, body: travelBody("OCR 删除锁") }); if (!item) throw new Error("fixture");
    const { attachment, invoice } = await addInvoice(item.id);
    for (const ocrStatus of ["QUEUED", "PROCESSING"] as const) {
      await prisma.reimbursementInvoice.update({ where: { id: invoice.id }, data: { ocrStatus } });
      await expect(service.removeInvoice({ actor: applicant, reimbursementId: item.id, invoiceId: invoice.id })).rejects.toMatchObject({ code: "REIMBURSEMENT_INVOICE_INVALID", status: 422 });
      expect(await prisma.reimbursementInvoice.findUnique({ where: { id: invoice.id } })).not.toBeNull();
      expect(await prisma.attachmentLink.count({ where: { attachmentId: attachment.id } })).toBe(1);
    }
    await prisma.reimbursementInvoice.update({ where: { id: invoice.id }, data: { ocrStatus: "FAILED" } });
    await expect(service.removeInvoice({ actor: applicant, reimbursementId: item.id, invoiceId: invoice.id })).resolves.toMatchObject({ removed: true });
  });

  it("writes privacy-minimal outbox events and idempotent reimbursement messages/todos for the full lifecycle", async () => {
    const item = await service.create({ actor: applicant, body: travelBody("通知全链路") }); if (!item) throw new Error("fixture");
    const key = `notify-${randomUUID()}`;
    await service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: key });
    await service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: key });
    expect(await prisma.outboxEvent.count({ where: { aggregateType: "REIMBURSEMENT", aggregateId: item.id, eventType: "REIMBURSEMENT_SUBMITTED" } })).toBe(1);
    const payloads = await prisma.outboxEvent.findMany({ where: { aggregateType: "REIMBURSEMENT", aggregateId: item.id }, select: { payloadJson: true } });
    for (const { payloadJson } of payloads) expect(Object.keys(payloadJson as object).sort()).toEqual(["applicantPersonId", "eventKey", "managerRecipientIds", "reimbursementId", "toState"]);
    await dispatchReimbursementEvents(item.id, true);
    expect(await prisma.todo.count({ where: { aggregateId: item.id, personId: { in: [manager.personId, managerOnly.personId] }, todoType: "REIMBURSEMENT_REVIEW", status: "OPEN" } })).toBe(2);
    expect(await prisma.message.count({ where: { aggregateId: item.id, personId: { in: [manager.personId, managerOnly.personId] }, messageType: "REIMBURSEMENT_SUBMITTED" } })).toBe(2);
    const submittedMessage = await prisma.message.findFirstOrThrow({ where: { aggregateId: item.id, personId: manager.personId, messageType: "REIMBURSEMENT_SUBMITTED" } });
    await prisma.message.update({ where: { id: submittedMessage.id }, data: { readAt: new Date() } });

    await service.returnForRevision({ actor: manager, reimbursementId: item.id, body: { reason: "补充材料" } }); await dispatchReimbursementEvents(item.id, true);
    expect(await prisma.todo.count({ where: { aggregateId: item.id, personId: { in: [manager.personId, managerOnly.personId] }, todoType: "REIMBURSEMENT_REVIEW", status: "STALE" } })).toBe(2);
    expect(await prisma.todo.count({ where: { aggregateId: item.id, todoType: "REIMBURSEMENT_REVISE", status: "OPEN", personId: applicant.personId } })).toBe(1);
    expect(await prisma.message.findFirst({ where: { aggregateId: item.id, personId: applicant.personId, messageType: "REIMBURSEMENT_RETURNED" } })).toMatchObject({ summary: "你的报销已退回修改" });

    await service.update({ actor: applicant, reimbursementId: item.id, body: travelBody("通知重新提交") });
    await service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: `resubmit-${randomUUID()}` });
    const resubmittedEvent = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: item.id, eventType: "REIMBURSEMENT_SUBMITTED", publishedAt: null } });
    await dispatchReimbursementEvents(item.id, true);
    expect(await prisma.todo.count({ where: { aggregateId: item.id, todoType: "REIMBURSEMENT_REVISE", status: "STALE" } })).toBe(1);
    expect(await prisma.message.count({ where: { aggregateId: item.id, personId: { in: [manager.personId, managerOnly.personId] }, messageType: "REIMBURSEMENT_SUBMITTED" } })).toBe(2);
    expect(await prisma.message.findUniqueOrThrow({ where: { id: submittedMessage.id } })).toMatchObject({ readAt: null, eventAt: resubmittedEvent.occurredAt });
    await service.verify({ actor: manager, reimbursementId: item.id }); await dispatchReimbursementEvents(item.id, true);
    expect(await prisma.todo.count({ where: { aggregateId: item.id, status: "OPEN" } })).toBe(0);
    expect(await prisma.message.findFirst({ where: { aggregateId: item.id, messageType: "REIMBURSEMENT_VERIFIED" } })).toMatchObject({ summary: "报销线上核对已完成" });

    await service.paperReceived({ actor: manager, reimbursementId: item.id }); await dispatchReimbursementEvents(item.id, true);
    expect(await prisma.todo.count({ where: { aggregateId: item.id, personId: { in: [manager.personId, managerOnly.personId] }, todoType: "REIMBURSEMENT_SUBMIT_FINANCE", status: "OPEN" } })).toBe(2);
    await service.paperIncomplete({ actor: manager, reimbursementId: item.id, body: { reason: "缺签字" } }); await dispatchReimbursementEvents(item.id, true);
    expect(await prisma.todo.count({ where: { aggregateId: item.id, personId: { in: [manager.personId, managerOnly.personId] }, todoType: "REIMBURSEMENT_SUBMIT_FINANCE", status: "STALE" } })).toBe(2);
    expect(await prisma.todo.count({ where: { aggregateId: item.id, personId: applicant.personId, todoType: { contains: "PAPER" } } })).toBe(0);
    await service.paperReceived({ actor: manager, reimbursementId: item.id }); await dispatchReimbursementEvents(item.id, true);
    expect(await prisma.message.count({ where: { aggregateId: item.id, personId: applicant.personId, messageType: "REIMBURSEMENT_PAPER_RECEIVED" } })).toBe(1);
    await service.financeSubmitted({ actor: manager, reimbursementId: item.id }); await dispatchReimbursementEvents(item.id, true);
    expect(await prisma.todo.count({ where: { aggregateId: item.id, status: "OPEN" } })).toBe(0);
    expect(await prisma.message.findFirst({ where: { aggregateId: item.id, messageType: "REIMBURSEMENT_FINANCE_SUBMITTED" } })).toMatchObject({ summary: expect.stringMatching(/不代表审批通过或已经付款/) });
    expect(await prisma.message.count({ where: { aggregateId: item.id, personId: { in: [applicant.personId, manager.personId, managerOnly.personId] }, messageType: { startsWith: "REIMBURSEMENT_" } } })).toBe(7);
  });

  it("blocks risky taxi/dining warnings from every travel expense and enforces OCR confirmation states", async () => {
    const item = await service.create({ actor: applicant, body: travelBody("OCR 状态边界") }); if (!item) throw new Error("fixture");
    const attachment = await prisma.attachment.create({ data: { originalFilename: "warning.pdf", extension: "pdf", declaredMimeType: "application/pdf", expectedSizeBytes: BigInt(8), actualSizeBytes: BigInt(8), bucket: "test", region: "test", objectKey: `reimbursement/${randomUUID()}.pdf`, uploadStatus: "UPLOADED", scanStatus: "PASSED", isTemporary: false, uploadedByPersonId: applicant.personId } }); attachments.push(attachment.id);
    const invoice = await prisma.reimbursementInvoice.create({ data: { reimbursementId: item.id, attachmentId: attachment.id, ocrStatus: "READY", ocrWarning: "餐饮票据不能作为出行报销费用，请人工核对" } });
    await expect(service.confirmInvoice({ actor: applicant, reimbursementId: item.id, invoiceId: invoice.id, body: { expenseType: "TRAVEL_LODGING", amount: "10.00" } })).rejects.toMatchObject({ code: "REIMBURSEMENT_EXPENSE_INVALID" });
    await prisma.reimbursementInvoice.update({ where: { id: invoice.id }, data: { ocrWarning: null, ocrStatus: "PROCESSING" } });
    await expect(service.confirmInvoice({ actor: applicant, reimbursementId: item.id, invoiceId: invoice.id, body: { expenseType: "TRAVEL_LODGING", amount: "10.00" } })).rejects.toMatchObject({ code: "REIMBURSEMENT_INVOICE_INVALID" });
    await prisma.reimbursementInvoice.update({ where: { id: invoice.id }, data: { ocrStatus: "FAILED" } });
    const confirmed = await service.confirmInvoice({ actor: applicant, reimbursementId: item.id, invoiceId: invoice.id, body: { expenseType: "TRAVEL_LODGING", amount: "10.00", invoiceNo: "STABLE-1" } });
    await expect(service.confirmInvoice({ actor: applicant, reimbursementId: item.id, invoiceId: invoice.id, body: { expenseType: "TRAVEL_TRANSPORT_ACTUAL", amount: "999.00" } })).resolves.toEqual(confirmed);
    await expect(service.requestInvoiceOcr({ actor: applicant, reimbursementId: item.id, invoiceId: invoice.id })).rejects.toMatchObject({ code: "REIMBURSEMENT_INVOICE_INVALID" });
  });

  it("rolls back submit when any invoice attachment is not fully uploaded, scanned and persisted", async () => {
    const item = await service.create({ actor: applicant, body: travelBody("附件门禁") }); if (!item) throw new Error("fixture");
    const attachment = await prisma.attachment.create({ data: { originalFilename: "pending.pdf", extension: "pdf", declaredMimeType: "application/pdf", expectedSizeBytes: BigInt(8), bucket: "test", region: "test", uploadStatus: "PENDING_UPLOAD", scanStatus: "PENDING", isTemporary: false, uploadedByPersonId: applicant.personId } }); attachments.push(attachment.id);
    await prisma.reimbursementInvoice.create({ data: { reimbursementId: item.id, attachmentId: attachment.id } });
    await expect(service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: `attachment-gate-${randomUUID()}` })).rejects.toMatchObject({ code: "REIMBURSEMENT_INVOICE_INVALID", status: 422 });
    expect(await prisma.reimbursement.findUniqueOrThrow({ where: { id: item.id } })).toMatchObject({ status: "DRAFT", currentSubmissionVersionId: null });
    expect(await prisma.reimbursementSubmissionVersion.count({ where: { reimbursementId: item.id } })).toBe(0);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: item.id } })).toBe(0);
  });

  it("populates correction forward-state DB fields once and never clears or rewrites historical handlers", async () => {
    const item = await service.create({ actor: applicant, body: travelBody("纠正形状") }); if (!item) throw new Error("fixture");
    await service.submit({ actor: applicant, reimbursementId: item.id, idempotencyKey: `correct-${randomUUID()}` });
    await service.correctState({ actor: manager, reimbursementId: item.id, body: { fromState: "PENDING_ONLINE_REVIEW", toState: "VERIFIED_PENDING_PAPER", reason: "纠正漏记核对" } });
    await service.correctState({ actor: manager, reimbursementId: item.id, body: { fromState: "VERIFIED_PENDING_PAPER", toState: "PAPER_RECEIVED", reason: "纠正漏记纸质材料" } });
    const firstPaper = await prisma.reimbursement.findUniqueOrThrow({ where: { id: item.id } });
    expect(firstPaper.paperReceivedAt).not.toBeNull(); expect(firstPaper.paperReceivedByPersonId).toBe(manager.personId);
    await service.correctState({ actor: manager, reimbursementId: item.id, body: { fromState: "PAPER_RECEIVED", toState: "VERIFIED_PENDING_PAPER", reason: "回退复核" } });
    await service.correctState({ actor: managerOnly, reimbursementId: item.id, body: { fromState: "VERIFIED_PENDING_PAPER", toState: "PAPER_RECEIVED", reason: "重新前进" } });
    const secondPaper = await prisma.reimbursement.findUniqueOrThrow({ where: { id: item.id } });
    expect(secondPaper.paperReceivedAt?.getTime()).toBe(firstPaper.paperReceivedAt?.getTime()); expect(secondPaper.paperReceivedByPersonId).toBe(manager.personId);
    await service.correctState({ actor: managerOnly, reimbursementId: item.id, body: { fromState: "PAPER_RECEIVED", toState: "FINANCE_SUBMITTED", reason: "纠正财务提交" } });
    const finance = await prisma.reimbursement.findUniqueOrThrow({ where: { id: item.id } });
    expect(finance.financeSubmittedAt).not.toBeNull(); expect(finance.financeSubmittedByPersonId).toBe(managerOnly.personId);
    await service.correctState({ actor: manager, reimbursementId: item.id, body: { fromState: "FINANCE_SUBMITTED", toState: "PAPER_RECEIVED", reason: "回退核对" } });
    const backward = await prisma.reimbursement.findUniqueOrThrow({ where: { id: item.id } });
    expect(backward.financeSubmittedAt?.getTime()).toBe(finance.financeSubmittedAt?.getTime()); expect(backward.financeSubmittedByPersonId).toBe(managerOnly.personId);
    await dispatchReimbursementEvents(item.id, true);
    expect(await prisma.message.count({ where: { aggregateId: item.id, messageType: "REIMBURSEMENT_STATE_CORRECTED", personId: { in: [applicant.personId, manager.personId, managerOnly.personId] } } })).toBe(3);
    expect(await prisma.todo.count({ where: { aggregateId: item.id, todoType: "REIMBURSEMENT_SUBMIT_FINANCE", status: "OPEN", personId: { in: [manager.personId, managerOnly.personId] } } })).toBe(2);
    expect(await prisma.todo.count({ where: { aggregateId: item.id, todoType: "REIMBURSEMENT_SUBMIT_FINANCE", status: "STALE", personId: { in: [manager.personId, managerOnly.personId] } } })).toBeGreaterThanOrEqual(4);
  });

  it("serializes manager/applicant and manager/manager races into one legal transition", async () => {
    const first = await service.create({ actor: applicant, body: travelBody("核对撤回竞争") }); if (!first) throw new Error("fixture");
    await service.submit({ actor: applicant, reimbursementId: first.id, idempotencyKey: `race-${randomUUID()}` });
    const reviewRace = await Promise.allSettled([service.verify({ actor: manager, reimbursementId: first.id }), service.withdraw({ actor: applicant, reimbursementId: first.id })]);
    expect(reviewRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const second = await service.create({ actor: applicant, body: travelBody("纸质财务竞争") }); if (!second) throw new Error("fixture");
    await service.submit({ actor: applicant, reimbursementId: second.id, idempotencyKey: `race-${randomUUID()}` }); await service.verify({ actor: manager, reimbursementId: second.id }); await service.paperReceived({ actor: manager, reimbursementId: second.id });
    const paperRace = await Promise.allSettled([service.financeSubmitted({ actor: manager, reimbursementId: second.id }), service.paperIncomplete({ actor: manager, reimbursementId: second.id, body: { reason: "材料缺项" } })]);
    expect(paperRace.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(["FINANCE_SUBMITTED", "VERIFIED_PENDING_PAPER"]).toContain((await prisma.reimbursement.findUniqueOrThrow({ where: { id: second.id } })).status);
  });
});
