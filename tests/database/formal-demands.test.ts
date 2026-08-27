import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AttachmentScanStatus, RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { registerDemandAttachmentAuthorizers } from "@/modules/demand/attachment-authorization";
import { FormalDemandService } from "@/modules/demand";
import { EnterpriseService } from "@/modules/enterprise";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

const prisma = getPrismaClient();
const service = new FormalDemandService();
const enterpriseService = new EnterpriseService();
const previousCurrentBatchIds: string[] = [];
let areaId: string;
let otherAreaId: string;
let currentBatchId: string;
let enterpriseId: string;
let contactId: string;
let admin: PermissionActor;
let admin2: PermissionActor;
let township: PermissionActor;
let township2: PermissionActor;
let otherTownship: PermissionActor;
let multiRole: PermissionActor;
let member: PermissionActor;

async function actorFixture(roleInput: RoleCode | RoleCode[], townshipAreaIds: string[] = []): Promise<PermissionActor> {
  const roles = Array.isArray(roleInput) ? roleInput : [roleInput];
  const person = await prisma.person.create({ data: { name: `M1-003 ${roles.join("+")} ${randomUUID()}` } });
  const account = await prisma.account.create({ data: {
    personId: person.id,
    phone: `1${Math.floor(10_000_000_00 + Math.random() * 89_999_999_99)}`,
    passwordHash: "database-test-only",
    status: "NORMAL",
    confidentialityConfirmedAt: new Date(),
  } });
  return {
    personId: person.id,
    accountId: account.id,
    accountStatus: "NORMAL",
    permissionVersion: BigInt(1),
    effectiveRoles: roles,
    capabilities: resolveCapabilities(roles, new Set()),
    specialPermissions: new Set(),
    selfPersonId: person.id,
    townshipAreaIds,
    departmentAreaIds: [],
    hasGlobalPublished: true,
    hasGlobalOperational: roles.includes("ADMIN") || roles.includes("SUPER_ADMIN"),
    hasSystem: roles.includes("SUPER_ADMIN"),
    currentBatchMember: roles.includes("MEMBER_CURRENT"),
    currentBatchId,
    configurationIssues: [],
  };
}

function draftInput(overrides: Record<string, unknown> = {}) {
  return {
    enterpriseId,
    selectedContactId: contactId,
    title: `正式需求-${randomUUID()}`,
    originalDescription: "企业原始需求描述保持原样，审核员不可改写核心事实。",
    demandType: "TECHNICAL",
    urgency: "NORMAL",
    responsibleAreaId: areaId,
    internalNote: "仅内部可见",
    attachmentIds: [],
    ...overrides,
  };
}

async function createDraft(actor: PermissionActor, overrides: Record<string, unknown> = {}) {
  const sourceType = actor.effectiveRoles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN")
    ? "ADMIN_DIRECT"
    : "TOWNSHIP_DIRECT";
  return service.create({ actor, demand: draftInput({ sourceType, ...overrides }) });
}

async function submit(demandId: string, actor = township, key = `submit-${randomUUID()}`) {
  return service.submitReview({ actor, demandId, body: {}, idempotencyKey: key });
}

async function attachment(scanStatus: AttachmentScanStatus, uploadedByPersonId = township.personId) {
  return prisma.attachment.create({ data: {
    originalFilename: `formal-${randomUUID()}.pdf`,
    extension: "pdf",
    declaredMimeType: "application/pdf",
    expectedSizeBytes: BigInt(12),
    actualSizeBytes: BigInt(12),
    bucket: "test-private-bucket",
    region: "ap-test",
    objectKey: `formal/${randomUUID()}.pdf`,
    uploadStatus: "UPLOADED",
    scanStatus,
    isTemporary: true,
    uploadedByPersonId,
  } });
}

async function governedBusiness(label: string) {
  const enterprise = await prisma.enterprise.create({ data: {
    name: `${label}-${randomUUID()}`,
    responsibleAreaId: areaId,
    address: "宝应县正式需求并发测试地址",
    mainProducts: "并发测试",
    createdByPersonId: admin.personId,
  } });
  const [contact, replacement] = await Promise.all([
    prisma.enterpriseContact.create({ data: { enterpriseId: enterprise.id, name: `${label}联系人`, phone: `138${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, isPrimary: true, createdByPersonId: admin.personId } }),
    prisma.enterpriseContact.create({ data: { enterpriseId: enterprise.id, name: `${label}替换联系人`, phone: `137${Math.floor(10_000_000 + Math.random() * 89_999_999)}`, createdByPersonId: admin.personId } }),
  ]);
  await prisma.enterprise.update({ where: { id: enterprise.id }, data: { primaryContactId: contact.id } });
  return { enterprise, contact, replacement };
}

beforeAll(async () => {
  previousCurrentBatchIds.push(...(await prisma.batch.findMany({ where: { isCurrent: true }, select: { id: true } })).map(({ id }) => id));
  await prisma.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
  const [area, otherArea, batch] = await Promise.all([
    prisma.administrativeArea.create({ data: { name: `M1-003区域-${randomUUID()}`, type: "TOWNSHIP" } }),
    prisma.administrativeArea.create({ data: { name: `M1-003其他区域-${randomUUID()}`, type: "TOWNSHIP" } }),
    prisma.batch.create({ data: { name: `M1-003批次-${randomUUID()}`, year: 2026, startDate: new Date("2026-01-01"), status: "ACTIVE", isCurrent: true } }),
  ]);
  areaId = area.id;
  otherAreaId = otherArea.id;
  currentBatchId = batch.id;
  [admin, admin2, township, township2, otherTownship, multiRole, member] = await Promise.all([
    actorFixture("ADMIN"), actorFixture("ADMIN"), actorFixture("TOWNSHIP_STAFF", [areaId]),
    actorFixture("TOWNSHIP_STAFF", [areaId]), actorFixture("TOWNSHIP_STAFF", [otherAreaId]),
    actorFixture(["ADMIN", "TOWNSHIP_STAFF"], [areaId]), actorFixture("MEMBER_CURRENT"),
  ]);
  const enterprise = await prisma.enterprise.create({ data: {
    name: `M1-003正式企业-${randomUUID()}`,
    responsibleAreaId: areaId,
    address: "宝应县正式需求测试路1号",
    mainProducts: "高端装备",
    createdByPersonId: admin.personId,
  } });
  enterpriseId = enterprise.id;
  const [contact] = await Promise.all([
    prisma.enterpriseContact.create({ data: { enterpriseId, name: "需求联系人", positionTitle: "技术负责人", phone: "13800005003", isPrimary: true, createdByPersonId: admin.personId } }),
    prisma.enterpriseContact.create({ data: { enterpriseId, name: "替换联系人", positionTitle: "副总经理", phone: "13800005004", createdByPersonId: admin.personId } }),
  ]);
  contactId = contact.id;
  await prisma.enterprise.update({ where: { id: enterpriseId }, data: { primaryContactId: contactId } });
});

afterAll(async () => {
  await prisma.batch.updateMany({ where: { id: currentBatchId }, data: { isCurrent: false } });
  if (previousCurrentBatchIds.length > 0) await prisma.batch.updateMany({ where: { id: { in: previousCurrentBatchIds } }, data: { isCurrent: true } });
  await prisma.$disconnect();
});

describe("M1-003 real MySQL formal demand workflow", () => {
  it("creates scoped direct drafts with immutable provenance and supports DRAFT/RETURNED edits", async () => {
    const townshipDraft = await createDraft(township);
    const adminDraft = await createDraft(admin);
    expect(townshipDraft.provenances).toEqual([expect.objectContaining({ sourceType: "TOWNSHIP_DIRECT" })]);
    expect(adminDraft.provenances).toEqual([expect.objectContaining({ sourceType: "ADMIN_DIRECT" })]);
    await expect(createDraft(otherTownship)).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE", status: 403 });
    const updated = await service.updateDraft({ actor: township, demandId: townshipDraft.id, changes: { title: "镇区修改后的核心标题" } });
    expect(updated?.title).toBe("镇区修改后的核心标题");
    await submit(townshipDraft.id);
    await service.review({ actor: admin, demandId: townshipDraft.id, review: { decision: "RETURN", reason: "补充量化目标" } });
    await expect(service.updateDraft({ actor: township, demandId: townshipDraft.id, changes: { originalDescription: "退回后补充的量化目标与原始需求。" } })).resolves.toMatchObject({ status: "RETURNED" });
    await expect(prisma.demandProvenance.update({ where: { id: townshipDraft.provenances[0].id }, data: { sourceType: "ADMIN_DIRECT" } })).rejects.toThrow();
  });

  it("unions ADMIN and TOWNSHIP source paths while rejecting forged direct sources", async () => {
    await expect(createDraft(township, { sourceType: "ADMIN_DIRECT" }))
      .rejects.toMatchObject({ code: "FORBIDDEN_SCOPE", status: 403 });
    await expect(createDraft(admin, { sourceType: "TOWNSHIP_DIRECT" }))
      .rejects.toMatchObject({ code: "FORBIDDEN_SCOPE", status: 403 });
    await expect(service.formOptions({ actor: township, sourceType: "ADMIN_DIRECT" }))
      .rejects.toMatchObject({ code: "FORBIDDEN_SCOPE", status: 403 });
    await expect(service.formOptions({ actor: admin, sourceType: "TOWNSHIP_DIRECT" }))
      .rejects.toMatchObject({ code: "FORBIDDEN_SCOPE", status: 403 });
    expect((await service.formOptions({ actor: multiRole, sourceType: "TOWNSHIP_DIRECT" })).areas.map(({ id }) => id))
      .toEqual([areaId]);
    expect((await service.formOptions({ actor: multiRole, sourceType: "ADMIN_DIRECT" })).areas.map(({ id }) => id))
      .toEqual(expect.arrayContaining([areaId, otherAreaId]));

    const townshipPath = await createDraft(multiRole, { sourceType: "TOWNSHIP_DIRECT" });
    const adminPath = await createDraft(multiRole, { sourceType: "ADMIN_DIRECT" });
    expect(townshipPath.provenances).toEqual([expect.objectContaining({ sourceType: "TOWNSHIP_DIRECT" })]);
    expect(adminPath.provenances).toEqual([expect.objectContaining({ sourceType: "ADMIN_DIRECT" })]);
    await expect(service.updateDraft({ actor: multiRole, demandId: townshipPath.id, changes: { title: "多角色镇区路径编辑" } }))
      .resolves.toMatchObject({ title: "多角色镇区路径编辑" });
    await expect(service.updateDraft({ actor: multiRole, demandId: adminPath.id, changes: { title: "多角色管理员路径编辑" } }))
      .resolves.toMatchObject({ title: "多角色管理员路径编辑" });
    await expect(submit(townshipPath.id, multiRole)).resolves.toMatchObject({ status: "PENDING_REVIEW" });
    await expect(submit(adminPath.id, multiRole)).resolves.toMatchObject({ status: "PENDING_REVIEW" });
  });

  it("implements true submit idempotency and one transition under concurrent replay", async () => {
    const draft = await createDraft(township);
    const key = `same-${randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 8 }, () => submit(draft.id, township, key)));
    expect(new Set(results.map((result) => JSON.stringify(result))).size).toBe(1);
    expect(await prisma.stateTransitionHistory.count({ where: { entityType: "DEMAND", entityId: draft.id, actionCode: "DEMAND_SUBMITTED_FOR_REVIEW" } })).toBe(1);
    expect(await prisma.demandCommandIdempotency.count({ where: { demandId: draft.id } })).toBe(1);
    const other = await createDraft(township);
    await expect(submit(other.id, township, key)).rejects.toMatchObject({ code: "DEMAND_IDEMPOTENCY_CONFLICT" });
  });

  it("returns one stable 409 and fully rolls back the losing demand for a concurrent cross-demand key", async () => {
    const [first, second] = await Promise.all([createDraft(township), createDraft(township)]);
    const key = `cross-demand-${randomUUID()}`;
    const settled = await Promise.allSettled([
      submit(first.id, township, key),
      submit(second.id, township, key),
    ]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "DEMAND_IDEMPOTENCY_CONFLICT", status: 409 });
    const loserId = settled[0].status === "rejected" ? first.id : second.id;
    expect(await prisma.demand.findUniqueOrThrow({ where: { id: loserId } })).toMatchObject({ status: "DRAFT" });
    expect(await prisma.demandCommandIdempotency.count({ where: { demandId: { in: [first.id, second.id] } } })).toBe(1);
    expect(await prisma.stateTransitionHistory.count({ where: {
      entityType: "DEMAND", entityId: loserId, actionCode: "DEMAND_SUBMITTED_FOR_REVIEW",
    } })).toBe(0);
    expect(await prisma.auditLog.count({ where: {
      entityType: "DEMAND", entityId: loserId, actionCode: "DEMAND_SUBMITTED_FOR_REVIEW",
    } })).toBe(0);
  });

  it("serializes double review and approve-vs-return without drifting firstPublishedAt", async () => {
    const doubleApprove = await createDraft(township);
    await submit(doubleApprove.id);
    const approvals = await Promise.allSettled([
      service.review({ actor: admin, demandId: doubleApprove.id, review: { decision: "APPROVE" } }),
      service.review({ actor: admin2, demandId: doubleApprove.id, review: { decision: "APPROVE" } }),
    ]);
    expect(approvals.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const published = await prisma.demand.findUniqueOrThrow({ where: { id: doubleApprove.id } });
    expect(published.status).toBe("PENDING_CLAIM");
    expect(published.firstPublishedAt).not.toBeNull();
    expect(await prisma.demandReview.count({ where: { demandId: doubleApprove.id, decision: "APPROVE" } })).toBe(1);
    const fixedPublishedAt = published.firstPublishedAt;
    await expect(prisma.demand.update({ where: { id: published.id }, data: { firstPublishedAt: new Date() } })).rejects.toThrow();
    expect((await prisma.demand.findUniqueOrThrow({ where: { id: published.id } })).firstPublishedAt).toEqual(fixedPublishedAt);

    const conflict = await createDraft(township);
    await submit(conflict.id);
    const decisions = await Promise.allSettled([
      service.review({ actor: admin, demandId: conflict.id, review: { decision: "APPROVE", urgency: "URGENT" } }),
      service.review({ actor: admin2, demandId: conflict.id, review: { decision: "RETURN", reason: "信息不足" } }),
    ]);
    expect(decisions.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(await prisma.demandReview.count({ where: { demandId: conflict.id } })).toBe(1);
  });

  it("allows auxiliary review edits, rejects core mass assignment, and constrains direct publish", async () => {
    const townshipDraft = await createDraft(township);
    await submit(townshipDraft.id);
    await expect(service.review({ actor: admin, demandId: townshipDraft.id, review: { decision: "APPROVE", title: "审核员不得改核心" } })).rejects.toThrow();
    await expect(service.directPublish({ actor: township, demandId: townshipDraft.id, body: {} })).rejects.toMatchObject({ status: 403 });
    await expect(service.directPublish({ actor: admin, demandId: townshipDraft.id, body: {} })).rejects.toMatchObject({ code: "DEMAND_STATE_CONFLICT" });

    const adminDraft = await createDraft(admin);
    const direct = await service.directPublish({ actor: admin, demandId: adminDraft.id, body: {} });
    expect(direct.status).toBe("PENDING_CLAIM");
    expect(direct.firstPublishedAt).not.toBeNull();
    await expect(service.updateDraft({ actor: admin, demandId: adminDraft.id, changes: { title: "发布后改核心" } })).rejects.toMatchObject({ code: "DEMAND_STATE_CONFLICT" });
  });

  it("enforces pre/post publish visibility, contact snapshot stability and attachment parent authorization", async () => {
    const passed = await attachment("PASSED");
    const draft = await createDraft(township, { attachmentIds: [passed.id] });
    await expect(service.detail({ actor: member, demandId: draft.id })).rejects.toMatchObject({ code: "DEMAND_NOT_FOUND", status: 404 });
    const link = await prisma.attachmentLink.findFirstOrThrow({ where: { attachmentId: passed.id, entityType: "DEMAND", entityId: draft.id } });
    const registry = new AttachmentParentAuthorizerRegistry();
    registerDemandAttachmentAuthorizers(registry);
    await expect(registry.authorizeAll({ actor: member, links: [link], action: "DOWNLOAD" })).resolves.toBe(false);
    await submit(draft.id);
    await service.review({ actor: admin, demandId: draft.id, review: { decision: "APPROVE" } });
    const visible = await service.detail({ actor: member, demandId: draft.id });
    expect(visible.contactSnapshot).toMatchObject({ contactPhone: "13800005003" });
    expect(visible.attachments).toEqual([expect.objectContaining({ id: passed.id, relationType: "FORMAL_ATTACHMENT" })]);
    await expect(registry.authorizeAll({ actor: member, links: [link], action: "DOWNLOAD" })).resolves.toBe(true);
    await enterpriseService.updateContact({ actor: admin, contactId, changes: { phone: "13800005999" } });
    expect((await prisma.demandContactSnapshot.findUniqueOrThrow({ where: { demandId: draft.id } })).contactPhone).toBe("13800005003");
    const stableDetail = await service.detail({ actor: member, demandId: draft.id });
    expect(stableDetail).toMatchObject({ internalNote: null, selectedContact: { phone: "13800005003", status: "SNAPSHOT" } });
    expect(stableDetail.provenances[0]).not.toHaveProperty("sourceSnapshot");
  });

  it("freezes attachments during review and blocks publication until every attachment passes", async () => {
    const scanning = await attachment("SCANNING");
    const draft = await createDraft(township, { attachmentIds: [scanning.id] });
    await submit(draft.id);
    await expect(service.updateDraft({ actor: township, demandId: draft.id, changes: { attachmentIds: [] } })).rejects.toMatchObject({ code: "DEMAND_STATE_CONFLICT" });
    await expect(service.review({ actor: admin, demandId: draft.id, review: { decision: "APPROVE" } })).rejects.toMatchObject({ code: "DEMAND_ATTACHMENT_NOT_PASSED" });
    await prisma.attachment.update({ where: { id: scanning.id }, data: { scanStatus: "PASSED" } });
    await expect(service.review({ actor: admin, demandId: draft.id, review: { decision: "APPROVE" } })).resolves.toMatchObject({ status: "PENDING_CLAIM" });
    const link = await prisma.attachmentLink.findFirstOrThrow({ where: { attachmentId: scanning.id, entityType: "DEMAND", entityId: draft.id } });
    await expect(prisma.attachmentLink.delete({ where: { id: link.id } })).rejects.toThrow();
  });

  it("lets same-township staff continue a draft and remove the prior uploader formal attachment only", async () => {
    const removable = await attachment("PASSED", township.personId);
    const sourceReference = await attachment("PASSED", township.personId);
    const draft = await createDraft(township, { attachmentIds: [removable.id] });
    await prisma.attachmentLink.create({ data: {
      attachmentId: sourceReference.id,
      entityType: "DEMAND",
      entityId: draft.id,
      relationType: "SOURCE_REFERENCE",
      createdByPersonId: township.personId,
    } });
    await prisma.attachment.update({ where: { id: sourceReference.id }, data: { isTemporary: false } });
    await submit(draft.id, township);
    await service.review({ actor: admin, demandId: draft.id, review: { decision: "RETURN", reason: "交由同镇区同事接续" } });

    await expect(service.updateDraft({
      actor: township2,
      demandId: draft.id,
      changes: { attachmentIds: [] },
    })).resolves.toMatchObject({ status: "RETURNED" });
    expect(await prisma.attachmentLink.count({ where: {
      attachmentId: removable.id, entityType: "DEMAND", entityId: draft.id, relationType: "FORMAL_ATTACHMENT",
    } })).toBe(0);
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: removable.id } })).toMatchObject({
      uploadedByPersonId: township.personId,
      isTemporary: true,
    });
    const sourceLink = await prisma.attachmentLink.findFirstOrThrow({ where: {
      attachmentId: sourceReference.id, entityType: "DEMAND", entityId: draft.id, relationType: "SOURCE_REFERENCE",
    } });
    await expect(prisma.attachmentLink.delete({ where: { id: sourceLink.id } })).rejects.toThrow();
  });

  it("keeps deterministic duplicate candidates and no consumerless lifecycle outbox", async () => {
    const source = await createDraft(admin, { title: "工业机器人视觉检测系统" });
    await service.directPublish({ actor: admin, demandId: source.id, body: {} });
    const candidate = await createDraft(township, { title: "机器人视觉检测" });
    const duplicates = await service.duplicateCandidates({ actor: admin, demandId: candidate.id });
    expect(duplicates).toEqual([expect.objectContaining({ id: source.id })]);
    expect(await prisma.outboxEvent.count({ where: { aggregateId: { in: [source.id, candidate.id] } } })).toBe(0);
  });

  it("linearizes submit/approve/direct-publish against enterprise merge/disable and contact disable", async () => {
    const submitBusiness = await governedBusiness("提交停用竞态");
    const submitDraft = await createDraft(township, { enterpriseId: submitBusiness.enterprise.id, selectedContactId: submitBusiness.contact.id });
    const submitDisable = await Promise.allSettled([
      submit(submitDraft.id),
      enterpriseService.disable({ actor: admin2, enterpriseId: submitBusiness.enterprise.id, reason: "并发停用" }),
    ]);
    const submitStored = await prisma.demand.findUniqueOrThrow({ where: { id: submitDraft.id } });
    const submitEnterprise = await prisma.enterprise.findUniqueOrThrow({ where: { id: submitBusiness.enterprise.id } });
    if (submitStored.status === "PENDING_REVIEW") expect(submitDisable[0].status).toBe("fulfilled");
    else {
      expect(submitEnterprise.status).toBe("DISABLED");
      expect(submitDisable[0].status).toBe("rejected");
    }

    const mergeBusiness = await governedBusiness("提交合并竞态");
    const mergeTarget = await governedBusiness("提交合并目标");
    const mergeDraft = await createDraft(township, { enterpriseId: mergeBusiness.enterprise.id, selectedContactId: mergeBusiness.contact.id });
    const submitMerge = await Promise.allSettled([
      submit(mergeDraft.id),
      enterpriseService.merge({ actor: admin2, enterpriseId: mergeBusiness.enterprise.id, targetEnterpriseId: mergeTarget.enterprise.id, reason: "并发合并", confirmation: "CONFIRM" }),
    ]);
    expect(submitMerge[0].status).toBe("fulfilled");
    expect(submitMerge[1]).toMatchObject({ status: "rejected", reason: { code: "ENTERPRISE_STATE_CONFLICT" } });

    const approveBusiness = await governedBusiness("审核联系人竞态");
    const approveDraft = await createDraft(township, { enterpriseId: approveBusiness.enterprise.id, selectedContactId: approveBusiness.contact.id });
    await submit(approveDraft.id);
    const approveContact = await Promise.allSettled([
      service.review({ actor: admin, demandId: approveDraft.id, review: { decision: "APPROVE" } }),
      enterpriseService.disableContact({ actor: admin2, contactId: approveBusiness.contact.id, replacementContactId: approveBusiness.replacement.id, reason: "并发离职" }),
    ]);
    const approved = await prisma.demand.findUniqueOrThrow({ where: { id: approveDraft.id } });
    const approvedContact = await prisma.enterpriseContact.findUniqueOrThrow({ where: { id: approveBusiness.contact.id } });
    if (approved.status === "PENDING_CLAIM") expect(approveContact[0].status).toBe("fulfilled");
    else {
      expect(approvedContact.status).toBe("INACTIVE");
      expect(approveContact[0].status).toBe("rejected");
    }

    const directBusiness = await governedBusiness("直发企业竞态");
    const directDraft = await createDraft(admin, { enterpriseId: directBusiness.enterprise.id, selectedContactId: directBusiness.contact.id });
    const directDisable = await Promise.allSettled([
      service.directPublish({ actor: admin, demandId: directDraft.id, body: {} }),
      enterpriseService.disable({ actor: admin2, enterpriseId: directBusiness.enterprise.id, reason: "并发停用" }),
    ]);
    const directStored = await prisma.demand.findUniqueOrThrow({ where: { id: directDraft.id } });
    const directEnterprise = await prisma.enterprise.findUniqueOrThrow({ where: { id: directBusiness.enterprise.id } });
    if (directStored.status === "PENDING_CLAIM") expect(directDisable[0].status).toBe("fulfilled");
    else {
      expect(directEnterprise.status).toBe("DISABLED");
      expect(directDisable[0].status).toBe("rejected");
    }
  });
});
