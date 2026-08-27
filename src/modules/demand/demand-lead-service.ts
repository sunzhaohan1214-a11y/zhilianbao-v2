import { createHash } from "node:crypto";
import type {
  DemandLead,
  DemandLeadStatus,
  Prisma,
} from "@/generated/prisma/client";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import {
  DEMAND_ENTITY,
  DEMAND_LEAD_ACTIONABLE_STATUSES,
  DEMAND_LEAD_ENTITY,
  DEMAND_LEAD_TERMINAL_STATUSES,
  ORIGINAL_ATTACHMENT_RELATION,
  SOURCE_ATTACHMENT_RELATION,
} from "./constants";
import { writeDemandAudit, writeDemandTransition, type DemandMutationContext } from "./audit";
import { DemandLeadError, isPrismaUniqueConflict } from "./errors";
import { DemandLeadRepository, type DemandTransaction } from "./repository/demand-lead-repository";
import {
  addDemandLeadInfoSchema,
  convertDemandLeadSchema,
  createOtherDemandLeadSchema,
  idempotencyKeySchema,
  memberVisitDemandLeadSchema,
  publicDemandLeadSchema,
  type ConvertDemandLeadInput,
  type MemberVisitDemandLeadInput,
  type OtherDemandLeadInput,
  type PublicDemandLeadInput,
} from "./schemas";

type ServiceInput = { actor: PermissionActor; context?: DemandMutationContext };

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function meaningfulPublicPayload(input: PublicDemandLeadInput) {
  return {
    responsibleAreaId: input.responsibleAreaId,
    enterpriseId: input.enterpriseId ?? null,
    enterpriseName: input.enterpriseName,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    title: input.title,
    description: input.description,
    truthConfirmed: input.truthConfirmed,
    contactConsent: input.contactConsent,
    attachments: input.attachments.map(({ attachmentId }) => attachmentId).sort(),
  };
}

function publicPayloadHash(input: PublicDemandLeadInput): string {
  return sha256(JSON.stringify(meaningfulPublicPayload(input)));
}

function shanghaiDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

function publicDuplicateWindowKey(input: PublicDemandLeadInput, at: Date): string {
  return sha256(`${shanghaiDay(at)}:${JSON.stringify(meaningfulPublicPayload(input))}`);
}

function snapshotLead(lead: Pick<DemandLead,
  "id" | "businessNo" | "sourceType" | "responsibleAreaId" | "enterpriseId"
  | "rawEnterpriseName" | "rawContactName" | "rawContactPhone" | "rawTitle"
  | "rawContent" | "sourcePersonId" | "sourceChannel" | "sourceAt" | "tripId" | "visitId"
>): Prisma.InputJsonObject {
  return {
    id: lead.id,
    businessNo: lead.businessNo,
    sourceType: lead.sourceType,
    responsibleAreaId: lead.responsibleAreaId,
    enterpriseId: lead.enterpriseId,
    rawEnterpriseName: lead.rawEnterpriseName,
    rawContactName: lead.rawContactName,
    rawContactPhone: lead.rawContactPhone,
    rawTitle: lead.rawTitle,
    rawContent: lead.rawContent,
    sourcePersonId: lead.sourcePersonId,
    sourceChannel: lead.sourceChannel,
    sourceAt: lead.sourceAt.toISOString(),
    tripId: lead.tripId,
    visitId: lead.visitId,
  };
}

function publicResult(lead: Pick<DemandLead, "businessNo">) {
  return {
    referenceNo: lead.businessNo,
    message: "提交成功，镇区工作人员将与您联系。",
  };
}

function requiredScope(actor: PermissionActor): "GLOBAL_OPERATIONAL" | "TOWNSHIP" {
  return actor.hasGlobalOperational ? "GLOBAL_OPERATIONAL" : "TOWNSHIP";
}

function assertBehavior(input: PublicDemandLeadInput, now = new Date()): void {
  const startedAt = new Date(input.formStartedAt);
  const elapsed = now.getTime() - startedAt.getTime();
  if (input.website !== "" || !Number.isFinite(elapsed) || elapsed < 800 || elapsed > 24 * 60 * 60 * 1000) {
    throw new DemandLeadError("DEMAND_LEAD_BEHAVIOR_REJECTED", "提交未通过基础行为校验，请刷新页面后重试");
  }
}

export class DemandLeadService {
  constructor(private readonly repository = new DemandLeadRepository()) {}

  async validatePublicArea(areaId: string): Promise<void> {
    await this.repository.transaction(async (tx) => { await this.requireArea(tx, areaId); });
  }

  private async checkPublicRateLimit(
    input: { ip: string; deviceId: string },
    namespace: "PUBLIC_DEMAND" | "PUBLIC_DEMAND_UPLOAD",
  ) {
    try {
      await this.repository.checkAndRecordPublicRateLimit(input, namespace);
    } catch (error) {
      if ((error as Error).message === "PUBLIC_DEMAND_RATE_LIMITED") {
        throw new DemandLeadError("DEMAND_LEAD_RATE_LIMITED", "提交过于频繁，请稍后再试");
      }
      throw error;
    }
  }

  async checkPublicUploadRateLimit(input: { ip: string; deviceId: string }) {
    await this.checkPublicRateLimit(input, "PUBLIC_DEMAND_UPLOAD");
  }

  private async requireArea(tx: DemandTransaction, areaId: string) {
    const area = await this.repository.findArea(tx, areaId);
    if (!area) throw new DemandLeadError("DEMAND_LEAD_AREA_INVALID", "负责区域不存在、已停用或不是合法镇区/园区");
    return area;
  }

  private async lockAndRequireNormalEnterprise(tx: DemandTransaction, enterpriseId: string) {
    let enterprise;
    try {
      enterprise = await this.repository.lockEnterprise(tx, enterpriseId);
    } catch (error) {
      if ((error as Error).message === "ENTERPRISE_LOCK_TARGET_NOT_FOUND") {
        throw new DemandLeadError("DEMAND_LEAD_ENTERPRISE_INVALID", "只能关联正常状态的正式企业");
      }
      throw error;
    }
    if (enterprise.status !== "NORMAL") {
      throw new DemandLeadError("DEMAND_LEAD_ENTERPRISE_INVALID", "只能关联正常状态的正式企业");
    }
    return enterprise;
  }

  private async authorizeLead(actor: PermissionActor, action: "demand.lead.view" | "demand.lead.verify", areaId: string) {
    return authorizeActor({ actor, action, resource: {
      resourceType: "demand_lead",
      requiredScope: requiredScope(actor),
      areaId,
    } });
  }

  private async linkOriginalAttachments(tx: DemandTransaction, input: {
    leadId: string;
    areaId: string;
    actorPersonId?: string;
    internalAttachmentIds?: readonly string[];
    publicAttachments?: readonly { attachmentId: string; uploadToken: string }[];
  }): Promise<void> {
    const publicTokenById = new Map((input.publicAttachments ?? []).map((item) => [item.attachmentId, sha256(item.uploadToken)]));
    const attachmentIds = [...new Set([
      ...(input.internalAttachmentIds ?? []),
      ...publicTokenById.keys(),
    ])].sort();
    if (attachmentIds.length > 10) throw new DemandLeadError("DEMAND_LEAD_ATTACHMENT_INVALID", "原始附件最多 10 个");
    for (const attachmentId of attachmentIds) {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM attachments WHERE id = ${attachmentId} FOR UPDATE
      `;
      if (rows.length !== 1) throw new DemandLeadError("DEMAND_LEAD_ATTACHMENT_INVALID", "附件不存在或已失效");
      const attachment = await tx.attachment.findUniqueOrThrow({ where: { id: attachmentId } });
      const publicTokenHash = publicTokenById.get(attachmentId);
      const ownershipAllowed = publicTokenHash
        ? attachment.uploadedByPersonId === null
          && attachment.publicAreaId === input.areaId
          && attachment.publicUploadTokenHash === publicTokenHash
          && attachment.uploadExpiresAt !== null
          && attachment.uploadExpiresAt > new Date()
        : Boolean(input.actorPersonId) && attachment.uploadedByPersonId === input.actorPersonId;
      if (
        !ownershipAllowed
        || !attachment.isTemporary
        || attachment.uploadStatus !== "UPLOADED"
        || !["PENDING", "SCANNING", "PASSED"].includes(attachment.scanStatus)
      ) {
        throw new DemandLeadError("DEMAND_LEAD_ATTACHMENT_INVALID", "附件当前状态或归属不允许关联线索");
      }
      await tx.attachmentLink.create({ data: {
        attachmentId,
        entityType: DEMAND_LEAD_ENTITY,
        entityId: input.leadId,
        relationType: ORIGINAL_ATTACHMENT_RELATION,
        createdByPersonId: input.actorPersonId,
      } });
      await tx.attachment.update({ where: { id: attachmentId }, data: {
        isTemporary: false,
        publicUploadTokenHash: null,
      } });
    }
  }

  private async createLeadInTransaction(tx: DemandTransaction, input: {
    sourceType: "ENTERPRISE_PUBLIC" | "MEMBER_VISIT" | "OTHER";
    responsibleAreaId: string;
    enterpriseId?: string;
    rawEnterpriseName?: string;
    rawContactName?: string;
    rawContactPhone?: string;
    rawTitle: string;
    rawContent: string;
    sourcePersonId?: string;
    sourceChannel?: string;
    sourceAt: Date;
    tripId?: string;
    visitId?: string;
    createdByPersonId?: string;
    publicDuplicateWindowKey?: string;
    context?: DemandMutationContext;
    actor?: PermissionActor;
    internalAttachmentIds?: readonly string[];
    publicAttachments?: readonly { attachmentId: string; uploadToken: string }[];
  }) {
    await this.requireArea(tx, input.responsibleAreaId);
    if (input.enterpriseId) await this.lockAndRequireNormalEnterprise(tx, input.enterpriseId);
    const businessNo = await this.repository.nextBusinessNo(tx, "XS", input.sourceAt);
    const lead = await tx.demandLead.create({ data: {
      businessNo,
      sourceType: input.sourceType,
      responsibleAreaId: input.responsibleAreaId,
      enterpriseId: input.enterpriseId,
      rawEnterpriseName: input.rawEnterpriseName,
      rawContactName: input.rawContactName,
      rawContactPhone: input.rawContactPhone,
      rawTitle: input.rawTitle,
      rawContent: input.rawContent,
      sourcePersonId: input.sourcePersonId,
      sourceChannel: input.sourceChannel,
      sourceAt: input.sourceAt,
      tripId: input.tripId,
      visitId: input.visitId,
      status: input.enterpriseId ? "PENDING_TOWNSHIP_VERIFY" : "PENDING_ENTERPRISE_LINK",
      createdByPersonId: input.createdByPersonId,
      publicDuplicateWindowKey: input.publicDuplicateWindowKey,
    } });
    await this.linkOriginalAttachments(tx, {
      leadId: lead.id,
      areaId: lead.responsibleAreaId,
      actorPersonId: input.createdByPersonId,
      internalAttachmentIds: input.internalAttachmentIds,
      publicAttachments: input.publicAttachments,
    });
    await writeDemandTransition(tx, {
      actor: input.actor,
      entityType: DEMAND_LEAD_ENTITY,
      entityId: lead.id,
      toState: lead.status,
      actionCode: "DEMAND_LEAD_CREATED",
      context: input.context,
      metadata: { sourceType: lead.sourceType, businessNo: lead.businessNo },
    });
    await writeDemandAudit(tx, {
      actor: input.actor,
      actionCode: "DEMAND_LEAD_CREATED",
      entityType: DEMAND_LEAD_ENTITY,
      entityId: lead.id,
      after: {
        businessNo: lead.businessNo,
        sourceType: lead.sourceType,
        responsibleAreaId: lead.responsibleAreaId,
        status: lead.status,
      },
      context: input.context,
    });
    return lead;
  }

  async createPublic(input: {
    payload: unknown;
    idempotencyKey: string | null;
    rateLimit: { ip: string; deviceId: string };
    context?: DemandMutationContext;
  }) {
    if (!input.idempotencyKey) {
      throw new DemandLeadError("DEMAND_LEAD_IDEMPOTENCY_REQUIRED", "公开提交必须提供 Idempotency-Key");
    }
    const key = idempotencyKeySchema.parse(input.idempotencyKey);
    const payload = publicDemandLeadSchema.parse(input.payload);
    const keyHash = sha256(`PUBLIC_DEMAND:${key}`);
    const payloadHash = publicPayloadHash(payload);
    const existing = await this.repository.findPublicIdempotency(keyHash);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new DemandLeadError("DEMAND_LEAD_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同内容");
      }
      return publicResult(existing.demandLead);
    }

    assertBehavior(payload);
    await this.checkPublicRateLimit(input.rateLimit, "PUBLIC_DEMAND");

    const now = new Date();
    const duplicateWindowKey = publicDuplicateWindowKey(payload, now);
    try {
      const lead = await this.repository.transaction(async (tx) => {
        const alreadyMapped = await tx.demandLeadPublicIdempotency.findUnique({
          where: { idempotencyKeyHash: keyHash }, include: { demandLead: true },
        });
        if (alreadyMapped) {
          if (alreadyMapped.payloadHash !== payloadHash) {
            throw new DemandLeadError("DEMAND_LEAD_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同内容");
          }
          return alreadyMapped.demandLead;
        }
        const duplicate = await tx.demandLead.findUnique({ where: { publicDuplicateWindowKey: duplicateWindowKey } });
        if (duplicate) {
          await tx.demandLeadPublicIdempotency.create({ data: {
            idempotencyKeyHash: keyHash, payloadHash, demandLeadId: duplicate.id,
          } });
          return duplicate;
        }
        const created = await this.createLeadInTransaction(tx, {
          sourceType: "ENTERPRISE_PUBLIC",
          responsibleAreaId: payload.responsibleAreaId,
          enterpriseId: payload.enterpriseId,
          rawEnterpriseName: payload.enterpriseName,
          rawContactName: payload.contactName,
          rawContactPhone: payload.contactPhone,
          rawTitle: payload.title,
          rawContent: payload.description,
          sourceChannel: "PUBLIC_WEB",
          sourceAt: now,
          publicDuplicateWindowKey: duplicateWindowKey,
          publicAttachments: payload.attachments,
          context: input.context,
        });
        await tx.demandLeadPublicIdempotency.create({ data: {
          idempotencyKeyHash: keyHash,
          payloadHash,
          demandLeadId: created.id,
        } });
        return created;
      });
      return publicResult(lead);
    } catch (error) {
      if (!isPrismaUniqueConflict(error)) throw error;
      const mapped = await this.repository.findPublicIdempotency(keyHash);
      if (mapped) {
        if (mapped.payloadHash !== payloadHash) {
          throw new DemandLeadError("DEMAND_LEAD_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同内容");
        }
        return publicResult(mapped.demandLead);
      }
      const duplicate = await this.repository.findPublicDuplicate(duplicateWindowKey);
      if (!duplicate) throw error;
      await this.repository.transaction(async (tx) => {
        await tx.demandLeadPublicIdempotency.upsert({
          where: { idempotencyKeyHash: keyHash },
          create: { idempotencyKeyHash: keyHash, payloadHash, demandLeadId: duplicate.id },
          update: {},
        });
      });
      return publicResult(duplicate);
    }
  }

  async createOther(input: ServiceInput & { lead: unknown }) {
    await authorizeActor({ actor: input.actor, action: "demand.lead.create" });
    if (!input.actor.hasGlobalOperational && !input.actor.effectiveRoles.includes("TOWNSHIP_STAFF")) {
      throw new DemandLeadError("DEMAND_LEAD_STATE_CONFLICT", "当前角色不能录入其他来源线索");
    }
    const lead = createOtherDemandLeadSchema.parse(input.lead);
    await authorizeActor({ actor: input.actor, action: "demand.lead.create", resource: {
      resourceType: "demand_lead",
      requiredScope: requiredScope(input.actor),
      areaId: lead.responsibleAreaId,
    } });
    return this.repository.transaction((tx) => this.createLeadInTransaction(tx, {
      ...lead,
      sourceType: "OTHER",
      sourceAt: lead.sourceAt ? new Date(lead.sourceAt) : new Date(),
      createdByPersonId: input.actor.personId,
      actor: input.actor,
      context: input.context,
      internalAttachmentIds: lead.attachmentIds,
    }));
  }

  async createFromMemberVisitInTransaction(
    tx: DemandTransaction,
    input: ServiceInput & { command: unknown },
  ) {
    await authorizeActor({ actor: input.actor, action: "demand.lead.create" });
    if (!input.actor.currentBatchMember || !input.actor.effectiveRoles.includes("MEMBER_CURRENT")) {
      throw new DemandLeadError("DEMAND_LEAD_STATE_CONFLICT", "只有当前批次在任团员可创建走访线索");
    }
    const command = memberVisitDemandLeadSchema.parse(input.command);
    return this.createLeadInTransaction(tx, {
      ...command,
      sourceType: "MEMBER_VISIT",
      sourceAt: new Date(command.sourceAt),
      sourcePersonId: input.actor.personId,
      createdByPersonId: input.actor.personId,
      actor: input.actor,
      context: input.context,
      internalAttachmentIds: command.attachmentIds,
    });
  }

  async createFromMemberVisit(input: ServiceInput & { command: unknown }) {
    return this.repository.transaction((tx) => this.createFromMemberVisitInTransaction(tx, input));
  }

  async list(input: ServiceInput & {
    query: {
      status?: DemandLeadStatus;
      sourceType?: "ENTERPRISE_PUBLIC" | "MEMBER_VISIT" | "OTHER";
      areaId?: string;
      keyword?: string;
      excludeId?: string;
      actionableOnly: boolean;
      page: number;
      pageSize: number;
    };
  }) {
    await authorizeActor({ actor: input.actor, action: "demand.lead.view" });
    if (input.query.areaId) await this.authorizeLead(input.actor, "demand.lead.view", input.query.areaId);
    return this.repository.listLeads({
      ...input.query,
      allowedAreaIds: input.actor.hasGlobalOperational ? undefined : input.actor.townshipAreaIds,
    });
  }

  async detail(input: ServiceInput & { leadId: string }) {
    const result = await this.repository.transaction(async (tx) => {
      const lead = await this.repository.findLead(tx, input.leadId);
      const attachments = lead ? await this.repository.findLeadAttachments(tx, lead.id) : [];
      return { lead, attachments };
    });
    const lead = result.lead;
    if (!lead) throw new DemandLeadError("DEMAND_LEAD_NOT_FOUND", "需求线索不存在");
    await this.authorizeLead(input.actor, "demand.lead.view", lead.responsibleAreaId);
    return {
      ...lead,
      attachments: result.attachments.map(({ attachment }) => ({
        ...attachment,
        actualSizeBytes: attachment.actualSizeBytes === null ? null : Number(attachment.actualSizeBytes),
      })),
    };
  }

  async addInfo(input: ServiceInput & { leadId: string; supplement: unknown }) {
    const supplement = addDemandLeadInfoSchema.parse(input.supplement);
    return this.repository.transaction(async (tx) => {
      try { await this.repository.lockLead(tx, input.leadId); } catch (error) {
        if ((error as Error).message === "DEMAND_LEAD_LOCK_TARGET_NOT_FOUND") throw new DemandLeadError("DEMAND_LEAD_NOT_FOUND", "需求线索不存在");
        throw error;
      }
      const lead = await tx.demandLead.findUniqueOrThrow({ where: { id: input.leadId } });
      await this.authorizeLead(input.actor, "demand.lead.verify", lead.responsibleAreaId);
      if (DEMAND_LEAD_TERMINAL_STATUSES.has(lead.status)) throw new DemandLeadError("DEMAND_LEAD_STATE_CONFLICT", "终态线索为只读记录");
      if (
        supplement.action === "REQUEST_MORE_INFO"
        && !["PENDING_TOWNSHIP_VERIFY", "PENDING_ENTERPRISE_LINK"].includes(lead.status)
      ) {
        throw new DemandLeadError("DEMAND_LEAD_STATE_CONFLICT", "当前状态不能标记待补充");
      }
      if (supplement.action === "ADD_SUPPLEMENT" && supplement.selectedContactId) {
        if (!lead.enterpriseId) throw new DemandLeadError("DEMAND_LEAD_CONTACT_INVALID", "未关联企业时不能选择正式联系人");
        const contact = await this.repository.findContact(tx, supplement.selectedContactId);
        if (!contact || contact.status !== "ACTIVE" || contact.enterpriseId !== lead.enterpriseId) {
          throw new DemandLeadError("DEMAND_LEAD_CONTACT_INVALID", "联系人不存在、已停用或不属于关联企业");
        }
      }
      const toStatus = supplement.action === "REQUEST_MORE_INFO"
        ? "NEED_MORE_INFO" as const
        : lead.status === "NEED_MORE_INFO"
          ? lead.enterpriseId ? "PENDING_TOWNSHIP_VERIFY" as const : "PENDING_ENTERPRISE_LINK" as const
          : lead.status;
      await tx.demandLeadSupplement.create({ data: {
        demandLeadId: lead.id,
        kind: supplement.action === "REQUEST_MORE_INFO" ? "MORE_INFO_REQUESTED" : "INFO_ADDED",
        note: supplement.note,
        verifiedTitle: supplement.action === "ADD_SUPPLEMENT" ? supplement.verifiedTitle : undefined,
        verifiedDescription: supplement.action === "ADD_SUPPLEMENT" ? supplement.verifiedDescription : undefined,
        demandType: supplement.action === "ADD_SUPPLEMENT" ? supplement.demandType : undefined,
        urgency: supplement.action === "ADD_SUPPLEMENT" ? supplement.urgency : undefined,
        selectedContactId: supplement.action === "ADD_SUPPLEMENT" ? supplement.selectedContactId : undefined,
        createdByPersonId: input.actor.personId,
      } });
      if (toStatus !== lead.status) {
        await tx.demandLead.update({ where: { id: lead.id }, data: { status: toStatus } });
        await writeDemandTransition(tx, {
          actor: input.actor, entityType: DEMAND_LEAD_ENTITY, entityId: lead.id,
          fromState: lead.status, toState: toStatus,
          actionCode: supplement.action === "REQUEST_MORE_INFO" ? "DEMAND_LEAD_MORE_INFO_REQUESTED" : "DEMAND_LEAD_SUPPLEMENT_COMPLETED",
          reason: supplement.note, context: input.context,
        });
      }
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: supplement.action === "REQUEST_MORE_INFO" ? "DEMAND_LEAD_MORE_INFO_REQUESTED" : "DEMAND_LEAD_INFO_ADDED",
        entityType: DEMAND_LEAD_ENTITY,
        entityId: lead.id,
        before: { status: lead.status },
        after: { status: toStatus, supplementAdded: true },
        reason: supplement.note,
        context: input.context,
      });
      return this.repository.findLead(tx, lead.id);
    });
  }

  async linkEnterprise(input: ServiceInput & { leadId: string; enterpriseId: string }) {
    return this.repository.transaction(async (tx) => {
      try { await this.repository.lockLead(tx, input.leadId); } catch (error) {
        if ((error as Error).message === "DEMAND_LEAD_LOCK_TARGET_NOT_FOUND") throw new DemandLeadError("DEMAND_LEAD_NOT_FOUND", "需求线索不存在");
        throw error;
      }
      const lead = await tx.demandLead.findUniqueOrThrow({ where: { id: input.leadId } });
      await this.authorizeLead(input.actor, "demand.lead.verify", lead.responsibleAreaId);
      if (lead.status !== "PENDING_ENTERPRISE_LINK") throw new DemandLeadError("DEMAND_LEAD_STATE_CONFLICT", "当前状态不能关联企业");
      const enterprise = await this.lockAndRequireNormalEnterprise(tx, input.enterpriseId);
      const updated = await tx.demandLead.update({ where: { id: lead.id }, data: {
        enterpriseId: enterprise.id,
        status: "PENDING_TOWNSHIP_VERIFY",
      } });
      await writeDemandTransition(tx, {
        actor: input.actor, entityType: DEMAND_LEAD_ENTITY, entityId: lead.id,
        fromState: lead.status, toState: updated.status, actionCode: "DEMAND_LEAD_ENTERPRISE_LINKED",
        metadata: { enterpriseId: enterprise.id }, context: input.context,
      });
      await writeDemandAudit(tx, {
        actor: input.actor, actionCode: "DEMAND_LEAD_ENTERPRISE_LINKED", entityType: DEMAND_LEAD_ENTITY, entityId: lead.id,
        before: { enterpriseId: lead.enterpriseId, status: lead.status },
        after: { enterpriseId: enterprise.id, status: updated.status }, context: input.context,
      });
      return this.repository.findLead(tx, lead.id);
    });
  }

  async merge(input: ServiceInput & { leadId: string; targetLeadId: string; reason: string; confirmation: "CONFIRM" }) {
    if (input.leadId === input.targetLeadId) throw new DemandLeadError("DEMAND_LEAD_STATE_CONFLICT", "线索不能合并到自身");
    return this.repository.transaction(async (tx) => {
      try { await this.repository.lockLeads(tx, [input.leadId, input.targetLeadId]); } catch (error) {
        if ((error as Error).message === "DEMAND_LEAD_LOCK_TARGET_NOT_FOUND") throw new DemandLeadError("DEMAND_LEAD_NOT_FOUND", "源线索或目标线索不存在");
        throw error;
      }
      const [source, target] = await Promise.all([
        tx.demandLead.findUnique({ where: { id: input.leadId } }),
        tx.demandLead.findUnique({ where: { id: input.targetLeadId } }),
      ]);
      if (!source || !target) throw new DemandLeadError("DEMAND_LEAD_NOT_FOUND", "源线索或目标线索不存在");
      await this.authorizeLead(input.actor, "demand.lead.verify", source.responsibleAreaId);
      await this.authorizeLead(input.actor, "demand.lead.view", target.responsibleAreaId);
      if (!DEMAND_LEAD_ACTIONABLE_STATUSES.has(source.status) || !DEMAND_LEAD_ACTIONABLE_STATUSES.has(target.status)) {
        throw new DemandLeadError("DEMAND_LEAD_STATE_CONFLICT", "源线索和目标线索都必须是可处理状态");
      }
      const updated = await tx.demandLead.update({ where: { id: source.id }, data: {
        status: "MERGED",
        mergedIntoLeadId: target.id,
        closeReason: null,
        closedFromStatus: null,
      } });
      await writeDemandTransition(tx, {
        actor: input.actor, entityType: DEMAND_LEAD_ENTITY, entityId: source.id,
        fromState: source.status, toState: "MERGED", actionCode: "DEMAND_LEAD_MERGED",
        reason: input.reason, metadata: { targetLeadId: target.id }, context: input.context,
      });
      await writeDemandAudit(tx, {
        actor: input.actor, actionCode: "DEMAND_LEAD_MERGED", entityType: DEMAND_LEAD_ENTITY, entityId: source.id,
        before: { status: source.status, mergedIntoLeadId: source.mergedIntoLeadId },
        after: { status: updated.status, mergedIntoLeadId: target.id }, reason: input.reason, context: input.context,
      });
      return this.repository.findLead(tx, source.id);
    });
  }

  async close(input: ServiceInput & { leadId: string; reason: string }) {
    return this.repository.transaction(async (tx) => {
      try { await this.repository.lockLead(tx, input.leadId); } catch (error) {
        if ((error as Error).message === "DEMAND_LEAD_LOCK_TARGET_NOT_FOUND") throw new DemandLeadError("DEMAND_LEAD_NOT_FOUND", "需求线索不存在");
        throw error;
      }
      const lead = await tx.demandLead.findUniqueOrThrow({ where: { id: input.leadId } });
      await this.authorizeLead(input.actor, "demand.lead.verify", lead.responsibleAreaId);
      if (!DEMAND_LEAD_ACTIONABLE_STATUSES.has(lead.status)) throw new DemandLeadError("DEMAND_LEAD_STATE_CONFLICT", "当前状态不能关闭");
      const updated = await tx.demandLead.update({ where: { id: lead.id }, data: {
        status: "CLOSED", closeReason: input.reason, closedFromStatus: lead.status,
      } });
      await writeDemandTransition(tx, { actor: input.actor, entityType: DEMAND_LEAD_ENTITY, entityId: lead.id, fromState: lead.status, toState: "CLOSED", actionCode: "DEMAND_LEAD_CLOSED", reason: input.reason, context: input.context });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_LEAD_CLOSED", entityType: DEMAND_LEAD_ENTITY, entityId: lead.id, before: { status: lead.status }, after: { status: "CLOSED" }, reason: input.reason, context: input.context });
      return updated;
    });
  }

  async restore(input: ServiceInput & { leadId: string; reason: string; confirmation: "CONFIRM" }) {
    await authorizeActor({ actor: input.actor, action: "demand.lead.restore", resource: {
      resourceType: "demand_lead", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    return this.repository.transaction(async (tx) => {
      try { await this.repository.lockLead(tx, input.leadId); } catch (error) {
        if ((error as Error).message === "DEMAND_LEAD_LOCK_TARGET_NOT_FOUND") throw new DemandLeadError("DEMAND_LEAD_NOT_FOUND", "需求线索不存在");
        throw error;
      }
      const lead = await tx.demandLead.findUniqueOrThrow({ where: { id: input.leadId } });
      if (lead.status !== "CLOSED") throw new DemandLeadError("DEMAND_LEAD_STATE_CONFLICT", "只有误关闭线索可以恢复");
      let toStatus: DemandLeadStatus;
      if (lead.closedFromStatus === "NEED_MORE_INFO") {
        toStatus = "NEED_MORE_INFO";
      } else if (lead.closedFromStatus === "PENDING_ENTERPRISE_LINK") {
        toStatus = "PENDING_ENTERPRISE_LINK";
      } else if (lead.closedFromStatus === "PENDING_TOWNSHIP_VERIFY") {
        if (!lead.enterpriseId) {
          toStatus = "PENDING_ENTERPRISE_LINK";
        } else {
          await this.lockAndRequireNormalEnterprise(tx, lead.enterpriseId);
          toStatus = "PENDING_TOWNSHIP_VERIFY";
        }
      } else {
        throw new DemandLeadError("DEMAND_LEAD_STATE_CONFLICT", "关闭前状态无效，不能恢复");
      }
      const updated = await tx.demandLead.update({ where: { id: lead.id }, data: {
        status: toStatus, closeReason: null, closedFromStatus: null,
      } });
      await writeDemandTransition(tx, { actor: input.actor, entityType: DEMAND_LEAD_ENTITY, entityId: lead.id, fromState: "CLOSED", toState: toStatus, actionCode: "DEMAND_LEAD_RESTORED", reason: input.reason, context: input.context });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_LEAD_RESTORED", entityType: DEMAND_LEAD_ENTITY, entityId: lead.id, before: { status: "CLOSED" }, after: { status: toStatus }, reason: input.reason, context: input.context });
      return updated;
    });
  }

  private async existingConversion(tx: DemandTransaction, lead: DemandLead) {
    if (!lead.convertedDemandId) throw new DemandLeadError("DEMAND_LEAD_STATE_CONFLICT", "线索转换状态不完整");
    return tx.demand.findUniqueOrThrow({
      where: { id: lead.convertedDemandId },
      include: { contactSnapshot: true, provenances: true },
    });
  }

  async convertToDraft(input: ServiceInput & { leadId: string; conversion: unknown }) {
    const conversion = convertDemandLeadSchema.parse(input.conversion);
    return this.repository.transaction(async (tx) => {
      try { await this.repository.lockLead(tx, input.leadId); } catch (error) {
        if ((error as Error).message === "DEMAND_LEAD_LOCK_TARGET_NOT_FOUND") throw new DemandLeadError("DEMAND_LEAD_NOT_FOUND", "需求线索不存在");
        throw error;
      }
      const lead = await tx.demandLead.findUniqueOrThrow({ where: { id: input.leadId } });
      await this.authorizeLead(input.actor, "demand.lead.verify", lead.responsibleAreaId);
      if (lead.status === "CONVERTED") return this.existingConversion(tx, lead);
      if (lead.status !== "PENDING_TOWNSHIP_VERIFY" || !lead.enterpriseId) {
        throw new DemandLeadError("DEMAND_LEAD_STATE_CONFLICT", "只有已关联企业且完成补充的待核验线索可以转换");
      }
      await this.requireArea(tx, lead.responsibleAreaId);
      const enterprise = await this.lockAndRequireNormalEnterprise(tx, lead.enterpriseId);
      const contact = await this.repository.lockContact(tx, conversion.selectedContactId);
      if (!contact || contact.status !== "ACTIVE" || contact.enterpriseId !== enterprise.id) {
        throw new DemandLeadError("DEMAND_LEAD_CONTACT_INVALID", "联系人不存在、已停用或不属于关联企业");
      }
      const currentBatches = await this.repository.lockCurrentBatch(tx);
      if (currentBatches.length !== 1) {
        throw new DemandLeadError("DEMAND_LEAD_CURRENT_BATCH_INVALID", "当前 ACTIVE 批次配置必须且只能有一条");
      }
      const businessNo = await this.repository.nextBusinessNo(tx, "XQ");
      const demand = await tx.demand.create({ data: {
        businessNo,
        enterpriseId: enterprise.id,
        responsibleAreaId: lead.responsibleAreaId,
        selectedContactId: contact.id,
        title: conversion.title,
        originalDescription: conversion.originalDescription,
        demandType: conversion.demandType,
        urgency: conversion.urgency,
        status: "DRAFT",
        creationBatchId: currentBatches[0].id,
        currentFollowBatchId: currentBatches[0].id,
        internalNote: conversion.internalNote,
        createdByPersonId: input.actor.personId,
      } });
      await tx.demandContactSnapshot.create({ data: {
        demandId: demand.id,
        enterpriseName: enterprise.name,
        contactName: contact.name,
        contactPosition: contact.positionTitle,
        contactPhone: contact.phone,
      } });
      await tx.demandLeadSupplement.create({ data: {
        demandLeadId: lead.id,
        kind: "CONVERSION_SNAPSHOT",
        verifiedTitle: conversion.title,
        verifiedDescription: conversion.originalDescription,
        demandType: conversion.demandType,
        urgency: conversion.urgency,
        selectedContactId: contact.id,
        note: conversion.internalNote,
        createdByPersonId: input.actor.personId,
      } });
      const sourceLeads = await tx.demandLead.findMany({
        where: { OR: [{ id: lead.id }, { status: "MERGED", mergedIntoLeadId: lead.id }] },
        orderBy: { id: "asc" },
      });
      await tx.demandProvenance.createMany({
        data: sourceLeads.map((source) => ({
          demandId: demand.id,
          sourceType: "DEMAND_LEAD" as const,
          demandLeadId: source.id,
          sourceSnapshot: snapshotLead(source),
        })),
      });
      const sourceLeadIds = sourceLeads.map(({ id }) => id);
      const sourceLinks = await tx.attachmentLink.findMany({
        where: { entityType: DEMAND_LEAD_ENTITY, entityId: { in: sourceLeadIds }, relationType: ORIGINAL_ATTACHMENT_RELATION },
        orderBy: [{ attachmentId: "asc" }, { entityId: "asc" }],
      });
      for (const attachmentId of [...new Set(sourceLinks.map(({ attachmentId }) => attachmentId))]) {
        await tx.attachmentLink.create({ data: {
          attachmentId,
          entityType: DEMAND_ENTITY,
          entityId: demand.id,
          relationType: SOURCE_ATTACHMENT_RELATION,
          createdByPersonId: input.actor.personId,
        } });
      }
      await tx.demandLead.update({ where: { id: lead.id }, data: {
        status: "CONVERTED",
        convertedDemandId: demand.id,
        closeReason: null,
        closedFromStatus: null,
      } });
      await writeDemandTransition(tx, { actor: input.actor, entityType: DEMAND_ENTITY, entityId: demand.id, toState: "DRAFT", actionCode: "DEMAND_DRAFT_CREATED_FROM_LEAD", metadata: { demandLeadId: lead.id, businessNo }, context: input.context });
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: "DEMAND_DRAFT_CREATED_FROM_LEAD",
        entityType: DEMAND_ENTITY,
        entityId: demand.id,
        after: {
          businessNo,
          status: "DRAFT",
          enterpriseId: demand.enterpriseId,
          selectedContactId: demand.selectedContactId,
          responsibleAreaId: demand.responsibleAreaId,
          demandLeadId: lead.id,
        },
        context: input.context,
      });
      await writeDemandTransition(tx, { actor: input.actor, entityType: DEMAND_LEAD_ENTITY, entityId: lead.id, fromState: lead.status, toState: "CONVERTED", actionCode: "DEMAND_LEAD_CONVERTED", metadata: { demandId: demand.id, businessNo }, context: input.context });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_LEAD_CONVERTED", entityType: DEMAND_LEAD_ENTITY, entityId: lead.id, before: { status: lead.status }, after: { status: "CONVERTED", demandId: demand.id, businessNo }, context: input.context });
      return tx.demand.findUniqueOrThrow({ where: { id: demand.id }, include: { contactSnapshot: true, provenances: true } });
    });
  }
}

export type { ConvertDemandLeadInput, MemberVisitDemandLeadInput, OtherDemandLeadInput };
