import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { RoleCode } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { AttachmentParentAuthorizerRegistry } from "@/modules/attachment/parent-authorization";
import { registerDemandAttachmentAuthorizers } from "@/modules/demand/attachment-authorization";
import { DemandLeadService } from "@/modules/demand";
import { EnterpriseService } from "@/modules/enterprise/enterprise-service";
import { resolveCapabilities, type PermissionActor } from "@/modules/permissions";

const prisma = getPrismaClient();
const service = new DemandLeadService();
const enterpriseService = new EnterpriseService();
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

async function governedEnterprise(label: string, withContact = false) {
  const enterprise = await prisma.enterprise.create({ data: {
    name: `${label}-${randomUUID()}`,
    responsibleAreaId: areaId,
    address: "宝应县并发治理测试地址",
    mainProducts: "并发治理测试",
    createdByPersonId: admin.personId,
  } });
  if (!withContact) return { enterprise, contact: null };
  const contact = await prisma.enterpriseContact.create({ data: {
    enterpriseId: enterprise.id,
    name: `${label}联系人`,
    phone: `138${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
    createdByPersonId: admin.personId,
  } });
  return { enterprise, contact };
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
    const rateLimit = { ip: `127.0.0.${Math.floor(Math.random() * 200) + 1}`, deviceId: `db-${randomUUID()}` };
    const attemptsBefore = await prisma.authRateLimitBucket.aggregate({ _sum: { attemptCount: true } });
    const results = await Promise.all(Array.from({ length: 10 }, () => service.createPublic({ payload, idempotencyKey: key, rateLimit })));
    expect(new Set(results.map(({ referenceNo }) => referenceNo)).size).toBe(1);
    const lead = await prisma.demandLead.findUniqueOrThrow({ where: { businessNo: results[0].referenceNo } });
    expect(await prisma.demandLead.count({ where: { id: lead.id } })).toBe(1);
    expect(await prisma.demandLeadPublicIdempotency.count({ where: { demandLeadId: lead.id } })).toBe(1);
    const attemptsAfterCreate = await prisma.authRateLimitBucket.aggregate({ _sum: { attemptCount: true } });
    const replay = await service.createPublic({
      payload: { ...payload, formStartedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
      idempotencyKey: key,
      rateLimit,
    });
    expect(replay.referenceNo).toBe(results[0].referenceNo);
    const attemptsAfterReplay = await prisma.authRateLimitBucket.aggregate({ _sum: { attemptCount: true } });
    expect(attemptsAfterReplay._sum.attemptCount).toBe(attemptsAfterCreate._sum.attemptCount);
    expect(Number(attemptsAfterCreate._sum.attemptCount ?? 0)).toBeGreaterThan(Number(attemptsBefore._sum.attemptCount ?? 0));
    await expect(service.createPublic({ payload: { ...payload, title: "不同内容" }, idempotencyKey: key, rateLimit })).rejects.toMatchObject({ code: "DEMAND_LEAD_IDEMPOTENCY_CONFLICT" });
  });

  it("uses an independent IP/device namespace for public upload intent throttling", async () => {
    const rateLimit = { ip: `198.51.100.${Math.floor(Math.random() * 200) + 1}`, deviceId: `upload-${randomUUID()}` };
    for (let attempt = 0; attempt < 30; attempt += 1) await service.checkPublicUploadRateLimit(rateLimit);
    await expect(service.checkPublicUploadRateLimit(rateLimit)).rejects.toMatchObject({ code: "DEMAND_LEAD_RATE_LIMITED", status: 429 });
    const payload = publicPayload(`上传限流隔离-${randomUUID()}`);
    await expect(service.createPublic({ payload, idempotencyKey: `submission-${randomUUID()}`, rateLimit }))
      .resolves.toMatchObject({ referenceNo: expect.stringMatching(/^XS-/) });
  });

  it("rejects an expired public attachment token when linking the lead", async () => {
    const uploadToken = randomUUID() + randomUUID();
    const attachment = await prisma.attachment.create({ data: {
      originalFilename: "expired-public.pdf",
      extension: "pdf",
      declaredMimeType: "application/pdf",
      expectedSizeBytes: BigInt(10),
      actualSizeBytes: BigInt(10),
      bucket: "test-private-bucket",
      region: "ap-test",
      objectKey: `expired/${randomUUID()}.pdf`,
      uploadStatus: "UPLOADED",
      scanStatus: "PASSED",
      isTemporary: true,
      publicUploadTokenHash: createHash("sha256").update(uploadToken).digest("hex"),
      publicAreaId: areaId,
      uploadExpiresAt: new Date(Date.now() - 1),
    } });
    const payload = { ...publicPayload(`过期附件-${randomUUID()}`), attachments: [{ attachmentId: attachment.id, uploadToken }] };
    await expect(service.createPublic({
      payload,
      idempotencyKey: `expired-${randomUUID()}`,
      rateLimit: { ip: "203.0.113.20", deviceId: `expired-${randomUUID()}` },
    })).rejects.toMatchObject({ code: "DEMAND_LEAD_ATTACHMENT_INVALID" });
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: attachment.id } })).isTemporary).toBe(true);
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

  it("restores NEED_MORE_INFO even when the lead has no enterprise", async () => {
    const lead = await service.createOther({ actor: admin, lead: otherLead() });
    await service.addInfo({ actor: admin, leadId: lead.id, supplement: { action: "REQUEST_MORE_INFO", note: "补充技术边界" } });
    await service.close({ actor: admin, leadId: lead.id, reason: "误关闭" });
    const restored = await service.restore({ actor: admin, leadId: lead.id, reason: "恢复待补充事实", confirmation: "CONFIRM" });
    expect(restored.status).toBe("NEED_MORE_INFO");
  });

  it("records audit and transitions without publishing consumerless Demand lifecycle Outbox", async () => {
    const lifecycleEventTypes = [
      "DEMAND_LEAD_CREATED", "DEMAND_LEAD_MORE_INFO_REQUESTED", "DEMAND_LEAD_INFO_ADDED",
      "DEMAND_LEAD_ENTERPRISE_LINKED", "DEMAND_LEAD_MERGED", "DEMAND_LEAD_CLOSED",
      "DEMAND_LEAD_RESTORED", "DEMAND_DRAFT_CREATED_FROM_LEAD",
    ];
    const lead = await service.createOther({ actor: admin, lead: otherLead() });
    await service.addInfo({ actor: admin, leadId: lead.id, supplement: { action: "REQUEST_MORE_INFO", note: "需要补充" } });
    await service.addInfo({ actor: admin, leadId: lead.id, supplement: { action: "ADD_SUPPLEMENT", note: "已补充" } });
    await service.linkEnterprise({ actor: admin, leadId: lead.id, enterpriseId });
    await service.close({ actor: admin, leadId: lead.id, reason: "误关闭" });
    await service.restore({ actor: admin, leadId: lead.id, reason: "恢复", confirmation: "CONFIRM" });
    const source = await service.createOther({ actor: admin, lead: otherLead() });
    const target = await service.createOther({ actor: admin, lead: otherLead() });
    await service.merge({ actor: admin, leadId: source.id, targetLeadId: target.id, reason: "重复", confirmation: "CONFIRM" });
    const convertedLead = await service.createOther({ actor: admin, lead: otherLead(undefined, true) });
    const demand = await service.convertToDraft({ actor: admin, leadId: convertedLead.id, conversion: {
      selectedContactId: contactId,
      title: "Outbox边界验证",
      originalDescription: "只记录审计和状态历史",
      demandType: "TECHNICAL",
      urgency: "NORMAL",
      confirmation: "CONFIRM",
    } });
    expect(await prisma.outboxEvent.count({
      where: { eventType: { in: lifecycleEventTypes }, aggregateId: { in: [lead.id, source.id, target.id, convertedLead.id, demand.id] } },
    })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: { in: [lead.id, source.id, convertedLead.id] } } })).toBeGreaterThan(0);
    expect(await prisma.stateTransitionHistory.count({ where: { entityId: { in: [lead.id, source.id, convertedLead.id, demand.id] } } })).toBeGreaterThan(0);
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

  it("blocks enterprise merge for Demand Lead or DRAFT dependencies and preserves dependency-free merge", async () => {
    const leadSource = await governedEnterprise("线索依赖源");
    const leadTarget = await governedEnterprise("线索依赖目标");
    await service.createOther({ actor: admin, lead: { ...otherLead(), enterpriseId: leadSource.enterprise.id, rawEnterpriseName: undefined } });
    await expect(enterpriseService.merge({
      actor: admin,
      enterpriseId: leadSource.enterprise.id,
      targetEnterpriseId: leadTarget.enterprise.id,
      reason: "应被依赖保护拒绝",
      confirmation: "CONFIRM",
    })).rejects.toMatchObject({ code: "ENTERPRISE_STATE_CONFLICT", status: 409 });

    const demandSource = await governedEnterprise("需求依赖源", true);
    const demandTarget = await governedEnterprise("需求依赖目标");
    await prisma.demand.create({ data: {
      businessNo: `XQ-2099-${randomUUID()}`,
      enterpriseId: demandSource.enterprise.id,
      responsibleAreaId: areaId,
      selectedContactId: demandSource.contact!.id,
      title: "独立草稿依赖",
      originalDescription: "验证企业合并依赖保护",
      demandType: "TECHNICAL",
      status: "DRAFT",
      creationBatchId: currentBatchId,
      currentFollowBatchId: currentBatchId,
      createdByPersonId: admin.personId,
    } });
    await expect(enterpriseService.merge({
      actor: admin,
      enterpriseId: demandSource.enterprise.id,
      targetEnterpriseId: demandTarget.enterprise.id,
      reason: "应被需求依赖保护拒绝",
      confirmation: "CONFIRM",
    })).rejects.toMatchObject({ code: "ENTERPRISE_STATE_CONFLICT", status: 409 });

    const freeSource = await governedEnterprise("无依赖源");
    const freeTarget = await governedEnterprise("无依赖目标");
    await expect(enterpriseService.merge({
      actor: admin,
      enterpriseId: freeSource.enterprise.id,
      targetEnterpriseId: freeTarget.enterprise.id,
      reason: "无依赖正常合并",
      confirmation: "CONFIRM",
    })).resolves.toMatchObject({ status: "MERGED", mergedIntoId: freeTarget.enterprise.id });
  });

  it("serializes link against enterprise merge without leaving a lead on a MERGED enterprise", async () => {
    const source = await governedEnterprise("关联竞态源");
    const target = await governedEnterprise("关联竞态目标");
    const lead = await service.createOther({ actor: admin, lead: otherLead() });
    const results = await Promise.allSettled([
      service.linkEnterprise({ actor: admin, leadId: lead.id, enterpriseId: source.enterprise.id }),
      enterpriseService.merge({ actor: admin, enterpriseId: source.enterprise.id, targetEnterpriseId: target.enterprise.id, reason: "并发合并", confirmation: "CONFIRM" }),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const [storedLead, storedEnterprise] = await Promise.all([
      prisma.demandLead.findUniqueOrThrow({ where: { id: lead.id } }),
      prisma.enterprise.findUniqueOrThrow({ where: { id: source.enterprise.id } }),
    ]);
    expect(storedLead.enterpriseId === source.enterprise.id && storedEnterprise.status === "MERGED").toBe(false);
  });

  it("serializes conversion against enterprise disable and contact disable", async () => {
    const enterpriseRace = await governedEnterprise("企业停用竞态", true);
    const lead = await service.createOther({ actor: admin, lead: { ...otherLead(), enterpriseId: enterpriseRace.enterprise.id, rawEnterpriseName: undefined } });
    const conversion = {
      selectedContactId: enterpriseRace.contact!.id,
      title: "企业停用竞态转换",
      originalDescription: "锁后复查企业和联系人状态",
      demandType: "TECHNICAL" as const,
      urgency: "NORMAL" as const,
      confirmation: "CONFIRM" as const,
    };
    const enterpriseResults = await Promise.allSettled([
      service.convertToDraft({ actor: admin, leadId: lead.id, conversion }),
      enterpriseService.disable({ actor: admin, enterpriseId: enterpriseRace.enterprise.id, reason: "并发停用" }),
    ]);
    expect(enterpriseResults[0].status === "fulfilled" || (await prisma.enterprise.findUniqueOrThrow({ where: { id: enterpriseRace.enterprise.id } })).status === "DISABLED").toBe(true);
    if (enterpriseResults[0].status === "fulfilled") {
      expect(await prisma.demandContactSnapshot.count({ where: { demandId: enterpriseResults[0].value.id } })).toBe(1);
    } else {
      expect(await prisma.demand.count({ where: { enterpriseId: enterpriseRace.enterprise.id } })).toBe(0);
    }

    const contactRace = await governedEnterprise("联系人停用竞态", true);
    const contactLead = await service.createOther({ actor: admin, lead: { ...otherLead(), enterpriseId: contactRace.enterprise.id, rawEnterpriseName: undefined } });
    const contactResults = await Promise.allSettled([
      service.convertToDraft({ actor: admin, leadId: contactLead.id, conversion: { ...conversion, selectedContactId: contactRace.contact!.id, title: "联系人停用竞态转换" } }),
      enterpriseService.disableContact({ actor: admin, contactId: contactRace.contact!.id, reason: "并发停用联系人" }),
    ]);
    if (contactResults[0].status === "fulfilled") {
      const snapshot = await prisma.demandContactSnapshot.findUniqueOrThrow({ where: { demandId: contactResults[0].value.id } });
      expect(snapshot.contactName).toBe(contactRace.contact!.name);
    } else {
      expect(await prisma.demand.count({ where: { enterpriseId: contactRace.enterprise.id } })).toBe(0);
      expect((await prisma.enterpriseContact.findUniqueOrThrow({ where: { id: contactRace.contact!.id } })).status).toBe("INACTIVE");
    }
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
