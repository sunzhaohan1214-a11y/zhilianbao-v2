import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { registerReimbursementAttachmentAuthorizers } from "@/modules/reimbursement/attachment-authorizer";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";
import { ReimbursementService } from "@/modules/reimbursement/reimbursement-service";

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

beforeAll(async () => {
  [applicant, outsider, minister, admin, manager, managerOnly, groupLeader, township, department, alumniGranted, alumniUngrant] = await Promise.all([
    actor("MEMBER_CURRENT", ["reimbursement.apply"], true), actor("MEMBER_CURRENT", ["reimbursement.apply"], true), actor("MINISTER"), actor("ADMIN"), actor("SUPER_ADMIN", ["reimbursement.manage"]),
    actor("MEMBER_ALUMNI_PLATFORM", ["reimbursement.manage"]), actor("GROUP_LEADER"), actor("TOWNSHIP_STAFF"), actor("DEPARTMENT_STAFF"), actor("MEMBER_ALUMNI_PLATFORM", ["reimbursement.apply"]), actor("MEMBER_ALUMNI_PLATFORM"),
  ]);
  const trip = await prisma.trip.create({ data: { title: "已完成招商行程", purpose: "企业拜访", overallEndAt: new Date(Date.now() - 86_400_000), createdByPersonId: applicant.personId,
    participants: { create: { personId: applicant.personId, isCreator: true, addedByPersonId: applicant.personId } },
    nodes: { create: { sequenceNo: 1, plannedStartAt: new Date(Date.now() - 172_800_000), plannedEndAt: new Date(Date.now() - 86_400_000), locationName: "上海", content: "企业拜访" } },
    result: { create: { resultSummary: "招商行程完成", submittedByPersonId: applicant.personId } } } });
  trips.push(trip.id); completedTripId = trip.id;
});

afterAll(async () => {
  const ids = (await prisma.reimbursement.findMany({ where: { applicantPersonId: { in: people } }, select: { id: true } })).map((x) => x.id);
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
  await prisma.account.deleteMany({ where: { id: { in: accounts } } }); await prisma.person.deleteMany({ where: { id: { in: people } } }); await prisma.$disconnect();
});

describe("B-M3-001 real MySQL reimbursement workflow", () => {
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
    expect(await prisma.outboxEvent.count({ where: { aggregateType: "REIMBURSEMENT", aggregateId: item.id } })).toBe(0);
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
