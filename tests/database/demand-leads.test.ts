import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { registerDemandAttachmentAuthorizers } from "@/modules/demand/attachment-authorization";
import { DemandLeadService } from "@/modules/demand";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

const prisma = getPrismaClient();
const service = new DemandLeadService();
const previousCurrentBatchIds: string[] = [];
let areaId: string;
let otherAreaId: string;
let enterpriseId: string;
let contactId: string;
let currentBatchId: string;
let admin: PermissionActor;
let admin2: PermissionActor;
let township: PermissionActor;
let otherTownship: PermissionActor;
let member: PermissionActor;

async function actorFixture(role: RoleCode, townshipAreaIds: string[] = []): Promise<PermissionActor> {
  const person = await prisma.person.create({ data: { name: `M1-002 ${role} ${randomUUID()}` } });
  const account = await prisma.account.create({ data: {
    personId: person.id,
    phone: `1${Math.floor(10_000_000_00 + Math.random() * 89_999_999_99)}`,
    passwordHash: "database-test-only",
    status: "NORMAL",
    confidentialityConfirmedAt: new Date(),
  } });
  const roles = [role];
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
    hasGlobalOperational: role === "ADMIN" || role === "SUPER_ADMIN",
    hasSystem: role === "SUPER_ADMIN",
    currentBatchMember: role === "MEMBER_CURRENT",
    currentBatchId,
    configurationIssues: [],
  };
}

function otherLead(title = `线索-${randomUUID()}`, withEnterprise = false) {
  return {
    responsibleAreaId: areaId,
    ...(withEnterprise ? { enterpriseId } : { rawEnterpriseName: "待建档测试企业" }),
    rawContactName: "王经理",
    rawContactPhone: "13800004001",
    rawTitle: title,
    rawContent: "原始需求内容，任何后续核验不得覆盖。",
    sourceChannel: "DATABASE_TEST",
    attachmentIds: [],
  };
}

function publicPayload(title: string) {
  return {
    responsibleAreaId: areaId,
    enterpriseName: "公开填报测试企业",
    contactName: "李经理",
    contactPhone: "13800004002",
    title,
    description: "公开填报的原始需求描述",
    truthConfirmed: true,
    contactConsent: true,
    formStartedAt: new Date(Date.now() - 2_000).toISOString(),
    website: "",
    attachments: [],
  };
}

async function convert(leadId: string) {
  return service.convertToDraft({
    actor: township,
    leadId,
    conversion: {
      selectedContactId: contactId,
      title: "人工核验后的正式标题",
      originalDescription: "镇区核验后的正式输入，原始来源仍保留。",
      demandType: "TECHNICAL",
      urgency: "NORMAL",
      confirmation: "CONFIRM",
    },
  });
}

beforeAll(async () => {
  previousCurrentBatchIds.push(...(await prisma.batch.findMany({ where: { isCurrent: true }, select: { id: true } })).map(({ id }) => id));
  await prisma.batch.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
  const [area, otherArea, batch] = await Promise.all([
    prisma.administrativeArea.create({ data: { name: `M1-002区域-${randomUUID()}`, type: "TOWNSHIP" } }),
    prisma.administrativeArea.create({ data: { name: `M1-002其他区域-${randomUUID()}`, type: "TOWNSHIP" } }),
    prisma.batch.create({ data: { name: `M1-002批次-${randomUUID()}`, year: 2026, startDate: new Date("2026-01-01"), status: "ACTIVE", isCurrent: true } }),
  ]);
  areaId = area.id;
  otherAreaId = otherArea.id;
  currentBatchId = batch.id;
  [admin, admin2, township, otherTownship, member] = await Promise.all([
    actorFixture("ADMIN"), actorFixture("ADMIN"), actorFixture("TOWNSHIP_STAFF", [areaId]),
    actorFixture("TOWNSHIP_STAFF", [otherAreaId]), actorFixture("MEMBER_CURRENT"),
  ]);
  const enterprise = await prisma.enterprise.create({ data: {
    name: `M1-002正式企业-${randomUUID()}`,
    responsibleAreaId: areaId,
    address: "宝应县测试路1号",
    mainProducts: "智能装备",
    createdByPersonId: admin.personId,
  } });
  enterpriseId = enterprise.id;
  const contact = await prisma.enterpriseContact.create({ data: {
    enterpriseId,
    name: "正式联系人",
    positionTitle: "技术负责人",
    phone: "13800004003",
    isPrimary: true,
    createdByPersonId: admin.personId,
  } });
  contactId = contact.id;
  await prisma.enterprise.update({ where: { id: enterpriseId }, data: { primaryContactId: contactId } });
});

afterAll(async () => {
  await prisma.batch.updateMany({ where: { id: currentBatchId }, data: { isCurrent: false } });
  if (previousCurrentBatchIds.length > 0) {
    await prisma.batch.updateMany({ where: { id: { in: previousCurrentBatchIds } }, data: { isCurrent: true } });
  }
  await prisma.$disconnect();
});

describe("M1-002 real MySQL Demand Lead workflow", () => {
  it("allocates 20 concurrent XS numbers without duplicates", async () => {
    const leads = await Promise.all(Array.from({ length: 20 }, (_, index) => service.createOther({
      actor: admin,
      lead: otherLead(`并发编号-${index}-${randomUUID()}`),
    })));
    expect(new Set(leads.map(({ businessNo }) => businessNo)).size).toBe(20);
    expect(leads.every(({ businessNo }) => /^XS-\d{4}-\d{6}$/.test(businessNo))).toBe(true);
  });

  it("collapses concurrent public submissions with the same Idempotency-Key", async () => {
    const key = `idem-${randomUUID()}`;
    const payload = publicPayload(`幂等公开提交-${randomUUID()}`);
    const results = await Promise.all(Array.from({ length: 10 }, () => service.createPublic({ payload, idempotencyKey: key })));
    expect(new Set(results.map(({ referenceNo }) => referenceNo)).size).toBe(1);
    const lead = await prisma.demandLead.findUniqueOrThrow({ where: { businessNo: results[0].referenceNo } });
    expect(await prisma.demandLead.count({ where: { id: lead.id } })).toBe(1);
    expect(await prisma.demandLeadPublicIdempotency.count({ where: { demandLeadId: lead.id } })).toBe(1);
    await expect(service.createPublic({ payload: { ...payload, title: "不同内容" }, idempotencyKey: key })).rejects.toMatchObject({ code: "DEMAND_LEAD_IDEMPOTENCY_CONFLICT" });
  });

  it("keeps source fields immutable and records supplements instead of overwriting", async () => {
    const lead = await service.createOther({ actor: township, lead: otherLead() });
    await service.addInfo({ actor: township, leadId: lead.id, supplement: { action: "REQUEST_MORE_INFO", note: "请补充技术参数" } });
    await service.addInfo({ actor: township, leadId: lead.id, supplement: { action: "ADD_SUPPLEMENT", verifiedDescription: "补充后的正式输入" } });
    const stored = await prisma.demandLead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stored.rawContent).toBe("原始需求内容，任何后续核验不得覆盖。");
    expect(stored.status).toBe("PENDING_ENTERPRISE_LINK");
    expect(await prisma.demandLeadSupplement.count({ where: { demandLeadId: lead.id } })).toBe(2);
    await expect(prisma.demandLead.update({ where: { id: lead.id }, data: { rawContent: "试图覆盖" } })).rejects.toThrow();
  });

  it("enforces NORMAL enterprise linking and township scope", async () => {
    const disabled = await prisma.enterprise.create({ data: {
      name: `停用企业-${randomUUID()}`, responsibleAreaId: areaId, address: "测试地址", mainProducts: "测试", status: "DISABLED", createdByPersonId: admin.personId,
    } });
    const lead = await service.createOther({ actor: township, lead: otherLead() });
    await expect(service.linkEnterprise({ actor: township, leadId: lead.id, enterpriseId: disabled.id })).rejects.toMatchObject({ code: "DEMAND_LEAD_ENTERPRISE_INVALID" });
    await expect(service.detail({ actor: otherTownship, leadId: lead.id })).rejects.toMatchObject({ code: "FORBIDDEN_SCOPE" });
    await expect(service.detail({ actor: member, leadId: lead.id })).rejects.toMatchObject({ code: "FORBIDDEN_CAPABILITY" });
    await expect(service.linkEnterprise({ actor: township, leadId: lead.id, enterpriseId })).resolves.toMatchObject({ status: "PENDING_TOWNSHIP_VERIFY" });
  });

  it("serializes merge/close on one lead so only one legal terminal action wins", async () => {
    const source = await service.createOther({ actor: admin, lead: otherLead() });
    const target = await service.createOther({ actor: admin, lead: otherLead() });
    const results = await Promise.allSettled([
      service.merge({ actor: admin, leadId: source.id, targetLeadId: target.id, reason: "重复线索", confirmation: "CONFIRM" }),
      service.close({ actor: admin2, leadId: source.id, reason: "无效线索" }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const stored = await prisma.demandLead.findUniqueOrThrow({ where: { id: source.id } });
    expect(["MERGED", "CLOSED"]).toContain(stored.status);
    await expect(service.addInfo({ actor: admin, leadId: source.id, supplement: { action: "ADD_SUPPLEMENT", note: "终态修改" } })).rejects.toMatchObject({ code: "DEMAND_LEAD_STATE_CONFLICT" });
  });

  it("fails safe when current ACTIVE batch is not unique", async () => {
    const lead = await service.createOther({ actor: township, lead: otherLead(undefined, true) });
    const extra = await prisma.batch.create({ data: { name: `错误current-${randomUUID()}`, year: 2027, startDate: new Date("2027-01-01"), status: "ACTIVE", isCurrent: true } });
    await expect(convert(lead.id)).rejects.toMatchObject({ code: "DEMAND_LEAD_CURRENT_BATCH_INVALID" });
    expect(await prisma.demand.count({ where: { provenances: { some: { demandLeadId: lead.id } } } })).toBe(0);
    await prisma.batch.update({ where: { id: extra.id }, data: { isCurrent: false } });
  });

  it("creates one idempotent DRAFT with XQ number, contact snapshot and provenance", async () => {
    const lead = await service.createOther({ actor: township, lead: otherLead(undefined, true) });
    const results = await Promise.all([convert(lead.id), convert(lead.id)]);
    expect(new Set(results.map(({ id }) => id)).size).toBe(1);
    expect(results[0]).toMatchObject({ status: "DRAFT", businessNo: expect.stringMatching(/^XQ-\d{4}-\d{6}$/) });
    expect(await prisma.demand.count({ where: { provenances: { some: { demandLeadId: lead.id } } } })).toBe(1);
    const snapshot = await prisma.demandContactSnapshot.findUniqueOrThrow({ where: { demandId: results[0].id } });
    expect(snapshot).toMatchObject({ enterpriseName: expect.any(String), contactName: "正式联系人", contactPhone: "13800004003" });
    await prisma.enterpriseContact.update({ where: { id: contactId }, data: { phone: "13800004999" } });
    expect((await prisma.demandContactSnapshot.findUniqueOrThrow({ where: { demandId: results[0].id } })).contactPhone).toBe("13800004003");
    await expect(service.close({ actor: admin, leadId: lead.id, reason: "转换后关闭" })).rejects.toMatchObject({ code: "DEMAND_LEAD_STATE_CONFLICT" });
    await prisma.enterpriseContact.update({ where: { id: contactId }, data: { phone: "13800004003" } });
  });

  it("preserves original attachment links, adds Demand references, and enforces parent authorization", async () => {
    const attachment = await prisma.attachment.create({ data: {
      originalFilename: "需求原始材料.pdf",
      extension: "pdf",
      declaredMimeType: "application/pdf",
      detectedMimeType: "application/pdf",
      detectedFileType: "pdf",
      expectedSizeBytes: BigInt(128),
      actualSizeBytes: BigInt(128),
      sha256: "a".repeat(64),
      bucket: "test-private-bucket",
      region: "ap-test",
      objectKey: `demand-test/${randomUUID()}.pdf`,
      uploadStatus: "UPLOADED",
      scanStatus: "PASSED",
      isTemporary: true,
      uploadedByPersonId: township.personId,
    } });
    const lead = await service.createOther({ actor: township, lead: { ...otherLead(undefined, true), attachmentIds: [attachment.id] } });
    const registry = new AttachmentParentAuthorizerRegistry();
    registerDemandAttachmentAuthorizers(registry);
    const link = { entityType: "DEMAND_LEAD", entityId: lead.id, relationType: "ORIGINAL" };
    await expect(registry.authorizeAll({ actor: township, links: [link], action: "DOWNLOAD" })).resolves.toBe(true);
    await expect(registry.authorizeAll({ actor: otherTownship, links: [link], action: "DOWNLOAD" })).resolves.toBe(false);
    await expect(registry.authorizeAll({ actor: member, links: [link], action: "DOWNLOAD" })).resolves.toBe(false);
    const demand = await convert(lead.id);
    expect(await prisma.attachmentLink.count({ where: { attachmentId: attachment.id, entityType: "DEMAND_LEAD", entityId: lead.id, relationType: "ORIGINAL" } })).toBe(1);
    expect(await prisma.attachmentLink.count({ where: { attachmentId: attachment.id, entityType: "DEMAND", entityId: demand.id, relationType: "SOURCE_REFERENCE" } })).toBe(1);
    const originalLink = await prisma.attachmentLink.findFirstOrThrow({ where: { attachmentId: attachment.id, entityType: "DEMAND_LEAD" } });
    await expect(prisma.attachmentLink.delete({ where: { id: originalLink.id } })).rejects.toThrow();
  });
});
