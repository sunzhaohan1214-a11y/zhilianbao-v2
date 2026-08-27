import { createHash } from "node:crypto";
import type { Demand, DemandStatus, Prisma } from "@/generated/prisma/client";
import { authorizeActor } from "@/modules/permissions/authorization";
import { PermissionError } from "@/modules/permissions/permission-errors";
import type { PermissionActor } from "@/modules/permissions/types";
import { getCurrentMemberEligibility } from "@/modules/member-foundation/current-member-eligibility";
import {
  DEMAND_ENTITY,
  DEMAND_PRE_PUBLISH_STATUSES,
  DEMAND_PUBLISHED_STATUSES,
  FORMAL_ATTACHMENT_RELATION,
} from "./constants";
import { writeDemandAudit, writeDemandTransition, type DemandMutationContext } from "./audit";
import {
  canCreateFormalDemandFromSource,
  canSubmitFormalDemandReview,
  formalDemandDraftEditSource,
  type DirectDemandSourceType,
} from "./formal-demand-access";
import { DemandError, isDemandCommandIdempotencyUniqueConflict, isPrismaUniqueConflict } from "./errors";
import { FormalDemandRepository, type FormalDemandTransaction } from "./repository/formal-demand-repository";
import {
  createFormalDemandSchema,
  applyDemandCollaborationSchema,
  claimDemandSchema,
  demandListQuerySchema,
  demandCollaborationPersonSchema,
  directPublishDemandSchema,
  endDemandCollaborationSchema,
  idempotencyKeySchema,
  reviewDemandSchema,
  submitDemandReviewSchema,
  updateDemandDraftSchema,
} from "./schemas";

type ServiceInput = { actor: PermissionActor; context?: DemandMutationContext };
type LockedEnterprise = NonNullable<Awaited<ReturnType<FormalDemandRepository["lockEnterprise"]>>>;
type LockedContact = NonNullable<Awaited<ReturnType<FormalDemandRepository["lockContact"]>>>;

const SUBMIT_ACTION = "DEMAND_SUBMIT_REVIEW";
const CLAIM_ACTION = "DEMAND_CLAIM";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isAdministrator(actor: PermissionActor): boolean {
  return actor.effectiveRoles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN");
}

function isPublished(status: DemandStatus): boolean {
  return DEMAND_PUBLISHED_STATUSES.has(status);
}

function commandResult(demand: Pick<Demand, "id" | "businessNo" | "status" | "submittedAt" | "firstPublishedAt">) {
  return {
    id: demand.id,
    businessNo: demand.businessNo,
    status: demand.status,
    submittedAt: demand.submittedAt?.toISOString() ?? null,
    firstPublishedAt: demand.firstPublishedAt?.toISOString() ?? null,
  };
}

function jsonCommandResult(value: Prisma.JsonValue): ReturnType<typeof commandResult> {
  const item = value as Record<string, unknown>;
  return {
    id: String(item.id),
    businessNo: String(item.businessNo),
    status: String(item.status) as DemandStatus,
    submittedAt: item.submittedAt === null ? null : String(item.submittedAt),
    firstPublishedAt: item.firstPublishedAt === null ? null : String(item.firstPublishedAt),
  };
}

function claimCommandResult(
  demand: Pick<Demand, "id" | "businessNo" | "status">,
  owner: { personId: string; name: string },
  claimedAt: Date,
) {
  return {
    demandId: demand.id,
    businessNo: demand.businessNo,
    status: demand.status,
    owner,
    claimedAt: claimedAt.toISOString(),
  };
}

function jsonClaimCommandResult(value: Prisma.JsonValue): ReturnType<typeof claimCommandResult> {
  const item = value as Record<string, unknown>;
  const owner = item.owner as Record<string, unknown>;
  return {
    demandId: String(item.demandId),
    businessNo: String(item.businessNo),
    status: String(item.status) as DemandStatus,
    owner: { personId: String(owner.personId), name: String(owner.name) },
    claimedAt: String(item.claimedAt),
  };
}

function snapshotDemand(demand: Pick<Demand,
  "enterpriseId" | "selectedContactId" | "title" | "originalDescription" | "responsibleAreaId"
  | "demandType" | "urgency" | "status" | "internalNote" | "submittedAt" | "firstPublishedAt"
>): Prisma.InputJsonObject {
  return {
    enterpriseId: demand.enterpriseId,
    selectedContactId: demand.selectedContactId,
    title: demand.title,
    originalDescription: demand.originalDescription,
    responsibleAreaId: demand.responsibleAreaId,
    demandType: demand.demandType,
    urgency: demand.urgency,
    status: demand.status,
    internalNote: demand.internalNote,
    submittedAt: demand.submittedAt?.toISOString() ?? null,
    firstPublishedAt: demand.firstPublishedAt?.toISOString() ?? null,
  };
}

function normalizedTitle(value: string): string {
  return value.toLocaleLowerCase("zh-CN").replace(/[\s\p{P}\p{S}]+/gu, "");
}

export function isDeterministicDuplicateTitle(source: string, candidate: string): boolean {
  const left = normalizedTitle(source);
  const right = normalizedTitle(candidate);
  if (left.length < 2 || right.length < 2) return false;
  return left.includes(right) || right.includes(left);
}

export class FormalDemandService {
  constructor(private readonly repository = new FormalDemandRepository()) {}

  private async lockDemandOrThrow(tx: FormalDemandTransaction, demandId: string): Promise<void> {
    try {
      await this.repository.lockDemand(tx, demandId);
    } catch (error) {
      if ((error as Error).message === "DEMAND_LOCK_TARGET_NOT_FOUND") {
        throw new DemandError("DEMAND_NOT_FOUND", "需求不存在或当前账号无权查看");
      }
      throw error;
    }
  }

  private async requireEligibleCurrentMember(tx: FormalDemandTransaction, personId: string) {
    const eligibility = await getCurrentMemberEligibility(tx, personId);
    if (!eligibility.eligible || !eligibility.batchId || !eligibility.person) {
      throw new DemandError("DEMAND_MEMBER_INELIGIBLE", "当前人员不是可参与需求的在任团员", {
        reason: eligibility.reason ?? "UNKNOWN",
      });
    }
    return { batchId: eligibility.batchId, person: eligibility.person };
  }

  private async requireActiveOwner(tx: FormalDemandTransaction, demand: Pick<Demand, "id" | "status" | "currentOwnerPersonId">) {
    if (demand.status !== "IN_PROGRESS" || !demand.currentOwnerPersonId) {
      throw new DemandError("DEMAND_STATE_CONFLICT", "需求尚未进入由有效负责人跟进的状态");
    }
    const activeOwners = await tx.demandOwnerHistory.findMany({
      where: { demandId: demand.id, activeKey: 1, expiredAt: null },
      select: { personId: true, batchId: true },
      take: 2,
    });
    if (activeOwners.length !== 1 || activeOwners[0].personId !== demand.currentOwnerPersonId) {
      throw new DemandError("DEMAND_STATE_CONFLICT", "需求负责人数据不一致，已拒绝继续操作");
    }
    return activeOwners[0];
  }

  private async requireNoPendingOrActiveCollaboration(
    tx: FormalDemandTransaction,
    demandId: string,
    personId: string,
  ): Promise<void> {
    const [pending, active] = await Promise.all([
      tx.demandCollaborationRequest.count({ where: { demandId, personId, status: "PENDING", pendingKey: 1 } }),
      tx.demandCollaborator.count({ where: { demandId, personId, status: "ACTIVE", activeKey: 1 } }),
    ]);
    if (pending > 0 || active > 0) {
      throw new DemandError("DEMAND_COLLABORATION_CONFLICT", "该人员已有待处理申请/邀请或正在协同");
    }
  }

  async formOptions(input: ServiceInput & { sourceType: DirectDemandSourceType }) {
    await authorizeActor({ actor: input.actor, action: "demand.formal.create" });
    if (input.sourceType === "ADMIN_DIRECT") {
      if (!isAdministrator(input.actor)) {
        throw new PermissionError("FORBIDDEN_SCOPE", "管理员代录入口仅限 ADMIN / SUPER_ADMIN");
      }
      await authorizeActor({
        actor: input.actor,
        action: "demand.formal.create",
        resource: { resourceType: "demand", requiredScope: "GLOBAL_OPERATIONAL" },
      });
    } else if (!input.actor.effectiveRoles.includes("TOWNSHIP_STAFF")) {
      throw new PermissionError("FORBIDDEN_SCOPE", "镇区录入入口仅限当前有效镇区工作人员");
    }
    return {
      areas: await this.repository.listAreas(
        input.sourceType === "ADMIN_DIRECT" ? undefined : input.actor.townshipAreaIds,
      ),
    };
  }

  private async requireArea(tx: FormalDemandTransaction, areaId: string) {
    const area = await this.repository.findArea(tx, areaId);
    if (!area) throw new DemandError("DEMAND_AREA_INVALID", "负责区域不存在、已停用或不是合法镇区/园区");
    return area;
  }

  private async lockAndValidateEnterpriseContact(
    tx: FormalDemandTransaction,
    enterpriseId: string,
    contactId: string,
  ): Promise<{ enterprise: LockedEnterprise; contact: LockedContact }> {
    const enterprise = await this.repository.lockEnterprise(tx, enterpriseId);
    if (!enterprise || enterprise.status !== "NORMAL") {
      throw new DemandError("DEMAND_ENTERPRISE_INVALID", "需求只能指向 NORMAL 正式企业");
    }
    const contact = await this.repository.lockContact(tx, contactId);
    if (!contact || contact.status !== "ACTIVE" || contact.enterpriseId !== enterprise.id) {
      throw new DemandError("DEMAND_CONTACT_INVALID", "联系人不存在、已停用或不属于需求企业");
    }
    return { enterprise, contact };
  }

  private async refreshContactSnapshot(
    tx: FormalDemandTransaction,
    demandId: string,
    enterprise: LockedEnterprise,
    contact: LockedContact,
  ) {
    return tx.demandContactSnapshot.upsert({
      where: { demandId },
      create: {
        demandId,
        enterpriseName: enterprise.name,
        contactName: contact.name,
        contactPosition: contact.positionTitle,
        contactPhone: contact.phone,
      },
      update: {
        enterpriseName: enterprise.name,
        contactName: contact.name,
        contactPosition: contact.positionTitle,
        contactPhone: contact.phone,
        snapshotAt: new Date(),
      },
    });
  }

  private async syncFormalAttachments(
    tx: FormalDemandTransaction,
    input: { demandId: string; actorPersonId: string; attachmentIds: readonly string[] },
  ): Promise<void> {
    const desiredIds = [...new Set(input.attachmentIds)].sort();
    const currentLinks = await tx.attachmentLink.findMany({
      where: { entityType: DEMAND_ENTITY, entityId: input.demandId, relationType: FORMAL_ATTACHMENT_RELATION },
      orderBy: { attachmentId: "asc" },
    });
    const currentIds = currentLinks.map(({ attachmentId }) => attachmentId);
    await this.repository.lockAttachments(tx, [...currentIds, ...desiredIds]);

    const desiredAttachments = desiredIds.length === 0 ? [] : await tx.attachment.findMany({
      where: { id: { in: desiredIds } },
      orderBy: { id: "asc" },
    });
    if (desiredAttachments.length !== desiredIds.length) {
      throw new DemandError("DEMAND_ATTACHMENT_INVALID", "附件不存在或已失效");
    }
    const currentSet = new Set(currentIds);
    for (const attachment of desiredAttachments) {
      if (currentSet.has(attachment.id)) continue;
      if (
        attachment.uploadedByPersonId !== input.actorPersonId
        || !attachment.isTemporary
        || attachment.uploadStatus !== "UPLOADED"
        || !["PENDING", "SCANNING", "PASSED"].includes(attachment.scanStatus)
      ) {
        throw new DemandError("DEMAND_ATTACHMENT_INVALID", "新附件必须由当前操作人上传且处于可关联状态");
      }
    }

    const desiredSet = new Set(desiredIds);
    for (const link of currentLinks) {
      if (desiredSet.has(link.attachmentId)) continue;
      await tx.attachmentLink.delete({ where: { id: link.id } });
      const remainingLinks = await tx.attachmentLink.count({ where: { attachmentId: link.attachmentId } });
      if (remainingLinks === 0) {
        await tx.attachment.update({ where: { id: link.attachmentId }, data: { isTemporary: true } });
      }
    }
    for (const attachment of desiredAttachments) {
      if (currentSet.has(attachment.id)) continue;
      await tx.attachmentLink.create({ data: {
        attachmentId: attachment.id,
        entityType: DEMAND_ENTITY,
        entityId: input.demandId,
        relationType: FORMAL_ATTACHMENT_RELATION,
        createdByPersonId: input.actorPersonId,
      } });
      await tx.attachment.update({ where: { id: attachment.id }, data: { isTemporary: false } });
    }
  }

  private async validateAttachments(
    tx: FormalDemandTransaction,
    demandId: string,
    requirePassed: boolean,
  ): Promise<void> {
    const links = await this.repository.demandAttachmentLinks(tx, demandId);
    await this.repository.lockAttachments(tx, links.map(({ attachmentId }) => attachmentId));
    const refreshed = await this.repository.demandAttachmentLinks(tx, demandId);
    for (const { attachment } of refreshed) {
      if (attachment.uploadStatus !== "UPLOADED") {
        throw new DemandError("DEMAND_ATTACHMENT_INVALID", "正式展示附件尚未完成上传");
      }
      if (requirePassed && attachment.scanStatus !== "PASSED") {
        throw new DemandError("DEMAND_ATTACHMENT_NOT_PASSED", "所有正式展示附件安全扫描通过后才能发布", {
          attachmentId: attachment.id,
          scanStatus: attachment.scanStatus,
        });
      }
      if (!requirePassed && !["PENDING", "SCANNING", "PASSED"].includes(attachment.scanStatus)) {
        throw new DemandError("DEMAND_ATTACHMENT_INVALID", "附件安全扫描结果不允许提交审核", {
          attachmentId: attachment.id,
          scanStatus: attachment.scanStatus,
        });
      }
    }
  }

  private assertDraftEditor(
    actor: PermissionActor,
    demand: Pick<Demand, "createdByPersonId" | "responsibleAreaId">,
    sourceTypes: Parameters<typeof formalDemandDraftEditSource>[2],
  ): void {
    if (!formalDemandDraftEditSource(actor, demand, sourceTypes)) {
      throw new DemandError("DEMAND_NOT_FOUND", "需求不存在或当前账号无权编辑");
    }
  }

  private assertSubmitter(
    actor: PermissionActor,
    demand: Pick<Demand, "responsibleAreaId">,
    sourceTypes: Parameters<typeof canSubmitFormalDemandReview>[2],
  ): void {
    if (!canSubmitFormalDemandReview(actor, demand, sourceTypes)) {
      throw new DemandError("DEMAND_NOT_FOUND", "需求不存在或当前账号无权提交审核");
    }
  }

  private async requireVisible(actor: PermissionActor, demand: Pick<Demand, "status" | "responsibleAreaId">): Promise<void> {
    if (isPublished(demand.status)) {
      await authorizeActor({
        actor,
        action: "demand.view",
        resource: { resourceType: "demand", requiredScope: "GLOBAL_PUBLISHED" },
      });
      return;
    }
    if (
      !actor.capabilities.has("demand.lead.view")
      || (!actor.hasGlobalOperational && !actor.townshipAreaIds.includes(demand.responsibleAreaId))
    ) {
      throw new DemandError("DEMAND_NOT_FOUND", "需求不存在或当前账号无权查看");
    }
  }

  async create(input: ServiceInput & { demand: unknown }) {
    const command = createFormalDemandSchema.parse(input.demand);
    await authorizeActor({ actor: input.actor, action: "demand.formal.create" });
    if (!canCreateFormalDemandFromSource(input.actor, command.sourceType, command.responsibleAreaId)) {
      throw new PermissionError("FORBIDDEN_SCOPE", "当前账号不能使用所选正式需求创建入口");
    }
    await authorizeActor({
      actor: input.actor,
      action: "demand.formal.create",
      resource: {
        resourceType: "demand",
        requiredScope: command.sourceType === "ADMIN_DIRECT" ? "GLOBAL_OPERATIONAL" : "TOWNSHIP",
        areaId: command.responsibleAreaId,
      },
    });
    return this.repository.transaction(async (tx) => {
      await this.requireArea(tx, command.responsibleAreaId);
      const { enterprise, contact } = await this.lockAndValidateEnterpriseContact(
        tx,
        command.enterpriseId,
        command.selectedContactId,
      );
      const batches = await this.repository.lockCurrentBatch(tx);
      if (batches.length !== 1) {
        throw new DemandError("DEMAND_CURRENT_BATCH_INVALID", "当前 ACTIVE 批次配置必须且只能有一条");
      }
      const businessNo = await this.repository.nextBusinessNo(tx);
      const demand = await tx.demand.create({ data: {
        businessNo,
        enterpriseId: enterprise.id,
        selectedContactId: contact.id,
        title: command.title,
        originalDescription: command.originalDescription,
        demandType: command.demandType,
        urgency: command.urgency,
        responsibleAreaId: command.responsibleAreaId,
        internalNote: command.internalNote,
        status: "DRAFT",
        creationBatchId: batches[0].id,
        currentFollowBatchId: batches[0].id,
        createdByPersonId: input.actor.personId,
      } });
      await tx.demandProvenance.create({ data: {
        demandId: demand.id,
        sourceType: command.sourceType,
        sourceSnapshot: {
          sourceType: command.sourceType,
          actorPersonId: input.actor.personId,
          enterpriseId: enterprise.id,
          responsibleAreaId: command.responsibleAreaId,
          createdAt: demand.createdAt.toISOString(),
        },
      } });
      await this.refreshContactSnapshot(tx, demand.id, enterprise, contact);
      await this.syncFormalAttachments(tx, {
        demandId: demand.id,
        actorPersonId: input.actor.personId,
        attachmentIds: command.attachmentIds,
      });
      await writeDemandTransition(tx, {
        actor: input.actor,
        entityType: DEMAND_ENTITY,
        entityId: demand.id,
        toState: "DRAFT",
        actionCode: "DEMAND_DIRECT_DRAFT_CREATED",
        metadata: { businessNo, sourceType: command.sourceType },
        context: input.context,
      });
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: "DEMAND_DIRECT_DRAFT_CREATED",
        entityType: DEMAND_ENTITY,
        entityId: demand.id,
        after: { ...snapshotDemand(demand), attachmentIds: command.attachmentIds },
        context: input.context,
      });
      const created = await this.repository.findDemand(tx, demand.id);
      if (!created) throw new Error("DEMAND_CREATED_ROW_MISSING");
      return created;
    });
  }

  async updateDraft(input: ServiceInput & { demandId: string; changes: unknown }) {
    const changes = updateDemandDraftSchema.parse(input.changes);
    await authorizeActor({ actor: input.actor, action: "demand.formal.create" });
    return this.repository.transaction(async (tx) => {
      try {
        await this.repository.lockDemand(tx, input.demandId);
      } catch (error) {
        if ((error as Error).message === "DEMAND_LOCK_TARGET_NOT_FOUND") {
          throw new DemandError("DEMAND_NOT_FOUND", "需求不存在或当前账号无权查看");
        }
        throw error;
      }
      const current = await tx.demand.findUniqueOrThrow({
        where: { id: input.demandId },
        include: { provenances: { select: { sourceType: true } } },
      });
      if (current.status !== "DRAFT" && current.status !== "RETURNED") {
        throw new DemandError("DEMAND_STATE_CONFLICT", "只有 DRAFT / RETURNED 需求可以编辑");
      }
      const sourceTypes = current.provenances.map(({ sourceType }) => sourceType);
      this.assertDraftEditor(input.actor, current, sourceTypes);

      const next = {
        enterpriseId: changes.enterpriseId ?? current.enterpriseId,
        selectedContactId: changes.selectedContactId ?? current.selectedContactId,
        title: changes.title ?? current.title,
        originalDescription: changes.originalDescription ?? current.originalDescription,
        demandType: changes.demandType ?? current.demandType,
        urgency: changes.urgency ?? current.urgency,
        responsibleAreaId: changes.responsibleAreaId ?? current.responsibleAreaId,
        internalNote: changes.internalNote === undefined
          ? current.internalNote
          : changes.internalNote === "" || changes.internalNote === null ? null : changes.internalNote,
      };
      this.assertDraftEditor(input.actor, { ...next, createdByPersonId: current.createdByPersonId }, sourceTypes);
      await this.requireArea(tx, next.responsibleAreaId);
      const { enterprise, contact } = await this.lockAndValidateEnterpriseContact(
        tx,
        next.enterpriseId,
        next.selectedContactId,
      );
      const beforeLinks = await tx.attachmentLink.findMany({
        where: { entityType: DEMAND_ENTITY, entityId: current.id, relationType: FORMAL_ATTACHMENT_RELATION },
        orderBy: { attachmentId: "asc" },
        select: { attachmentId: true },
      });
      if (changes.attachmentIds) {
        await this.syncFormalAttachments(tx, {
          demandId: current.id,
          actorPersonId: input.actor.personId,
          attachmentIds: changes.attachmentIds,
        });
      }
      const updated = await tx.demand.update({ where: { id: current.id }, data: next });
      await this.refreshContactSnapshot(tx, current.id, enterprise, contact);
      const afterLinks = await tx.attachmentLink.findMany({
        where: { entityType: DEMAND_ENTITY, entityId: current.id, relationType: FORMAL_ATTACHMENT_RELATION },
        orderBy: { attachmentId: "asc" },
        select: { attachmentId: true },
      });
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: "DEMAND_DRAFT_UPDATED",
        entityType: DEMAND_ENTITY,
        entityId: current.id,
        before: { ...snapshotDemand(current), attachmentIds: beforeLinks.map(({ attachmentId }) => attachmentId) },
        after: { ...snapshotDemand(updated), attachmentIds: afterLinks.map(({ attachmentId }) => attachmentId) },
        context: input.context,
      });
      const result = await this.repository.findDemand(tx, current.id);
      if (!result) throw new Error("DEMAND_UPDATED_ROW_MISSING");
      return result;
    });
  }

  async submitReview(input: ServiceInput & { demandId: string; body: unknown; idempotencyKey?: string | null }) {
    submitDemandReviewSchema.parse(input.body);
    const idempotencyKey = idempotencyKeySchema.safeParse(input.idempotencyKey);
    if (!idempotencyKey.success) {
      throw new DemandError("DEMAND_IDEMPOTENCY_REQUIRED", "提交审核必须提供有效 Idempotency-Key");
    }
    await authorizeActor({ actor: input.actor, action: "demand.submit_review" });
    const keyHash = sha256(idempotencyKey.data);
    const payloadHash = sha256(JSON.stringify({ demandId: input.demandId }));
    try {
      return await this.repository.transaction(async (tx) => {
        try {
          await this.repository.lockDemand(tx, input.demandId);
        } catch (error) {
          if ((error as Error).message === "DEMAND_LOCK_TARGET_NOT_FOUND") {
            throw new DemandError("DEMAND_NOT_FOUND", "需求不存在或当前账号无权查看");
          }
          throw error;
        }
        const replay = await this.repository.findIdempotencyForUpdate(tx, {
          actorPersonId: input.actor.personId,
          action: SUBMIT_ACTION,
          keyHash,
        });
        if (replay) {
          if (replay.demandId !== input.demandId || replay.payloadHash !== payloadHash) {
            throw new DemandError("DEMAND_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同提交内容");
          }
          return jsonCommandResult(replay.responseJson);
        }
        const demand = await tx.demand.findUniqueOrThrow({
          where: { id: input.demandId },
          include: { provenances: { select: { sourceType: true } } },
        });
        if (demand.status !== "DRAFT" && demand.status !== "RETURNED") {
          throw new DemandError("DEMAND_STATE_CONFLICT", "只有 DRAFT / RETURNED 需求可以提交审核");
        }
        this.assertSubmitter(input.actor, demand, demand.provenances.map(({ sourceType }) => sourceType));
        await this.requireArea(tx, demand.responsibleAreaId);
        await this.lockAndValidateEnterpriseContact(tx, demand.enterpriseId, demand.selectedContactId);
        await this.validateAttachments(tx, demand.id, false);
        const submittedAt = new Date();
        const updated = await tx.demand.update({ where: { id: demand.id }, data: {
          status: "PENDING_REVIEW",
          submittedAt,
          reviewedAt: null,
          reviewedByPersonId: null,
        } });
        await writeDemandTransition(tx, {
          actor: input.actor,
          entityType: DEMAND_ENTITY,
          entityId: demand.id,
          fromState: demand.status,
          toState: "PENDING_REVIEW",
          actionCode: "DEMAND_SUBMITTED_FOR_REVIEW",
          context: input.context,
        });
        await writeDemandAudit(tx, {
          actor: input.actor,
          actionCode: "DEMAND_SUBMITTED_FOR_REVIEW",
          entityType: DEMAND_ENTITY,
          entityId: demand.id,
          before: snapshotDemand(demand),
          after: snapshotDemand(updated),
          context: input.context,
        });
        const result = commandResult(updated);
        await tx.demandCommandIdempotency.create({ data: {
          actorPersonId: input.actor.personId,
          action: SUBMIT_ACTION,
          keyHash,
          payloadHash,
          demandId: demand.id,
          responseJson: result,
        } });
        return result;
      });
    } catch (error) {
      if (!isDemandCommandIdempotencyUniqueConflict(error)) throw error;
      const replay = await this.repository.findIdempotency({
        actorPersonId: input.actor.personId,
        action: SUBMIT_ACTION,
        keyHash,
      });
      if (!replay) throw error;
      if (replay.demandId !== input.demandId || replay.payloadHash !== payloadHash) {
        throw new DemandError("DEMAND_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同提交内容");
      }
      return jsonCommandResult(replay.responseJson);
    }
  }

  async review(input: ServiceInput & { demandId: string; review: unknown }) {
    const review = reviewDemandSchema.parse(input.review);
    await authorizeActor({
      actor: input.actor,
      action: "demand.review",
      resource: { resourceType: "demand", requiredScope: "GLOBAL_OPERATIONAL" },
    });
    return this.repository.transaction(async (tx) => {
      try {
        await this.repository.lockDemand(tx, input.demandId);
      } catch (error) {
        if ((error as Error).message === "DEMAND_LOCK_TARGET_NOT_FOUND") {
          throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
        }
        throw error;
      }
      const demand = await tx.demand.findUniqueOrThrow({ where: { id: input.demandId } });
      if (demand.status !== "PENDING_REVIEW") {
        throw new DemandError("DEMAND_STATE_CONFLICT", "该需求已被其他管理员处理");
      }
      const reviewedAt = new Date();
      const nextDemandType = review.demandType ?? demand.demandType;
      const nextUrgency = review.urgency ?? demand.urgency;

      if (review.decision === "RETURN") {
        const updated = await tx.demand.update({ where: { id: demand.id }, data: {
          status: "RETURNED",
          demandType: nextDemandType,
          urgency: nextUrgency,
          reviewedAt,
          reviewedByPersonId: input.actor.personId,
        } });
        await tx.demandReview.create({ data: {
          demandId: demand.id,
          decision: "RETURN",
          returnReason: review.reason!,
          reviewerPersonId: input.actor.personId,
          demandTypeBefore: demand.demandType,
          demandTypeAfter: nextDemandType,
          urgencyBefore: demand.urgency,
          urgencyAfter: nextUrgency,
          reviewedAt,
        } });
        await writeDemandTransition(tx, {
          actor: input.actor,
          entityType: DEMAND_ENTITY,
          entityId: demand.id,
          fromState: "PENDING_REVIEW",
          toState: "RETURNED",
          actionCode: "DEMAND_REVIEW_RETURNED",
          reason: review.reason,
          context: input.context,
        });
        await writeDemandAudit(tx, {
          actor: input.actor,
          actionCode: "DEMAND_REVIEW_RETURNED",
          entityType: DEMAND_ENTITY,
          entityId: demand.id,
          before: snapshotDemand(demand),
          after: snapshotDemand(updated),
          reason: review.reason,
          context: input.context,
        });
        return commandResult(updated);
      }

      await this.requireArea(tx, demand.responsibleAreaId);
      const { enterprise, contact } = await this.lockAndValidateEnterpriseContact(
        tx,
        demand.enterpriseId,
        demand.selectedContactId,
      );
      await this.validateAttachments(tx, demand.id, true);
      await this.refreshContactSnapshot(tx, demand.id, enterprise, contact);
      const firstPublishedAt = demand.firstPublishedAt ?? reviewedAt;
      const updated = await tx.demand.update({ where: { id: demand.id }, data: {
        status: "PENDING_CLAIM",
        demandType: nextDemandType,
        urgency: nextUrgency,
        reviewedAt,
        reviewedByPersonId: input.actor.personId,
        firstPublishedAt,
        publishedByPersonId: input.actor.personId,
      } });
      await tx.demandReview.create({ data: {
        demandId: demand.id,
        decision: "APPROVE",
        reviewerPersonId: input.actor.personId,
        demandTypeBefore: demand.demandType,
        demandTypeAfter: nextDemandType,
        urgencyBefore: demand.urgency,
        urgencyAfter: nextUrgency,
        reviewedAt,
      } });
      await writeDemandTransition(tx, {
        actor: input.actor,
        entityType: DEMAND_ENTITY,
        entityId: demand.id,
        fromState: "PENDING_REVIEW",
        toState: "PENDING_CLAIM",
        actionCode: "DEMAND_REVIEW_APPROVED_AND_PUBLISHED",
        context: input.context,
      });
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: "DEMAND_REVIEW_APPROVED_AND_PUBLISHED",
        entityType: DEMAND_ENTITY,
        entityId: demand.id,
        before: snapshotDemand(demand),
        after: snapshotDemand(updated),
        context: input.context,
      });
      return commandResult(updated);
    });
  }

  async directPublish(input: ServiceInput & { demandId: string; body: unknown }) {
    directPublishDemandSchema.parse(input.body);
    await authorizeActor({
      actor: input.actor,
      action: "demand.publish_direct",
      resource: { resourceType: "demand", requiredScope: "GLOBAL_OPERATIONAL" },
    });
    if (!isAdministrator(input.actor)) {
      throw new DemandError("DEMAND_NOT_FOUND", "只有 ADMIN / SUPER_ADMIN 可以管理员直发");
    }
    return this.repository.transaction(async (tx) => {
      try {
        await this.repository.lockDemand(tx, input.demandId);
      } catch (error) {
        if ((error as Error).message === "DEMAND_LOCK_TARGET_NOT_FOUND") {
          throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
        }
        throw error;
      }
      const demand = await tx.demand.findUniqueOrThrow({
        where: { id: input.demandId },
        include: { provenances: { select: { sourceType: true } } },
      });
      if (demand.status !== "DRAFT") {
        throw new DemandError("DEMAND_STATE_CONFLICT", "管理员直发仅允许 ADMIN_DIRECT DRAFT");
      }
      if (!demand.provenances.some(({ sourceType }) => sourceType === "ADMIN_DIRECT")) {
        throw new DemandError("DEMAND_PROVENANCE_INVALID", "镇区来源需求不能绕过审核直接发布");
      }
      await this.requireArea(tx, demand.responsibleAreaId);
      const { enterprise, contact } = await this.lockAndValidateEnterpriseContact(
        tx,
        demand.enterpriseId,
        demand.selectedContactId,
      );
      await this.validateAttachments(tx, demand.id, true);
      await this.refreshContactSnapshot(tx, demand.id, enterprise, contact);
      const publishedAt = new Date();
      const updated = await tx.demand.update({ where: { id: demand.id }, data: {
        status: "PENDING_CLAIM",
        reviewedAt: publishedAt,
        reviewedByPersonId: input.actor.personId,
        firstPublishedAt: demand.firstPublishedAt ?? publishedAt,
        publishedByPersonId: input.actor.personId,
      } });
      await writeDemandTransition(tx, {
        actor: input.actor,
        entityType: DEMAND_ENTITY,
        entityId: demand.id,
        fromState: "DRAFT",
        toState: "PENDING_CLAIM",
        actionCode: "DEMAND_ADMIN_DIRECT_PUBLISHED",
        context: input.context,
      });
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: "DEMAND_ADMIN_DIRECT_PUBLISHED",
        entityType: DEMAND_ENTITY,
        entityId: demand.id,
        before: snapshotDemand(demand),
        after: snapshotDemand(updated),
        context: input.context,
      });
      return commandResult(updated);
    });
  }

  async claim(input: ServiceInput & { demandId: string; body: unknown; idempotencyKey?: string | null }) {
    claimDemandSchema.parse(input.body);
    const idempotencyKey = idempotencyKeySchema.safeParse(input.idempotencyKey);
    if (!idempotencyKey.success) {
      throw new DemandError("DEMAND_IDEMPOTENCY_REQUIRED", "认领需求必须提供有效 Idempotency-Key");
    }
    await authorizeActor({ actor: input.actor, action: "demand.claim" });
    const keyHash = sha256(idempotencyKey.data);
    const payloadHash = sha256(JSON.stringify({ demandId: input.demandId }));
    try {
      return await this.repository.transaction(async (tx) => {
        await this.lockDemandOrThrow(tx, input.demandId);
        const replay = await this.repository.findIdempotencyForUpdate(tx, {
          actorPersonId: input.actor.personId,
          action: CLAIM_ACTION,
          keyHash,
        });
        if (replay) {
          if (replay.demandId !== input.demandId || replay.payloadHash !== payloadHash) {
            throw new DemandError("DEMAND_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同需求");
          }
          return jsonClaimCommandResult(replay.responseJson);
        }
        const demand = await tx.demand.findUniqueOrThrow({ where: { id: input.demandId } });
        if (demand.status !== "PENDING_CLAIM" || demand.firstPublishedAt === null || demand.currentOwnerPersonId !== null) {
          throw new DemandError("DEMAND_ALREADY_CLAIMED", "需求已被认领或当前状态不可认领");
        }
        const eligibility = await this.requireEligibleCurrentMember(tx, input.actor.personId);
        const activeOwnerCount = await tx.demandOwnerHistory.count({ where: {
          demandId: demand.id,
          activeKey: 1,
          expiredAt: null,
        } });
        if (activeOwnerCount !== 0) {
          throw new DemandError("DEMAND_ALREADY_CLAIMED", "需求已存在有效负责人");
        }
        const now = new Date();
        await tx.demandOwnerHistory.create({ data: {
          demandId: demand.id,
          personId: input.actor.personId,
          batchId: eligibility.batchId,
          effectiveAt: now,
          changeType: "CLAIM",
          createdByPersonId: input.actor.personId,
          activeKey: 1,
        } });
        const updated = await tx.demand.update({
          where: { id: demand.id },
          data: { status: "IN_PROGRESS", currentOwnerPersonId: input.actor.personId },
        });
        await writeDemandAudit(tx, {
          actor: input.actor,
          actionCode: "DEMAND_CLAIMED",
          entityType: DEMAND_ENTITY,
          entityId: demand.id,
          before: { status: demand.status, currentOwnerPersonId: null },
          after: { status: updated.status, currentOwnerPersonId: updated.currentOwnerPersonId },
          context: input.context,
        });
        await writeDemandTransition(tx, {
          actor: input.actor,
          entityType: DEMAND_ENTITY,
          entityId: demand.id,
          fromState: demand.status,
          toState: updated.status,
          actionCode: "DEMAND_CLAIMED",
          metadata: { currentOwnerPersonId: input.actor.personId, batchId: eligibility.batchId },
          context: input.context,
        });
        const result = claimCommandResult(updated, {
          personId: input.actor.personId,
          name: eligibility.person.name,
        }, now);
        await tx.demandCommandIdempotency.create({ data: {
          actorPersonId: input.actor.personId,
          action: CLAIM_ACTION,
          keyHash,
          payloadHash,
          demandId: demand.id,
          responseJson: result,
        } });
        return result;
      });
    } catch (error) {
      if (!isDemandCommandIdempotencyUniqueConflict(error)) throw error;
      const replay = await this.repository.findIdempotency({
        actorPersonId: input.actor.personId,
        action: CLAIM_ACTION,
        keyHash,
      });
      if (!replay) throw error;
      if (replay.demandId !== input.demandId || replay.payloadHash !== payloadHash) {
        throw new DemandError("DEMAND_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同需求");
      }
      return jsonClaimCommandResult(replay.responseJson);
    }
  }

  async applyCollaboration(input: ServiceInput & { demandId: string; body: unknown }) {
    applyDemandCollaborationSchema.parse(input.body);
    await authorizeActor({ actor: input.actor, action: "demand.collaboration.apply" });
    try {
      return await this.repository.transaction(async (tx) => {
        await this.lockDemandOrThrow(tx, input.demandId);
        const demand = await tx.demand.findUniqueOrThrow({ where: { id: input.demandId } });
        const owner = await this.requireActiveOwner(tx, demand);
        await this.requireEligibleCurrentMember(tx, input.actor.personId);
        if (owner.personId === input.actor.personId) {
          throw new DemandError("DEMAND_COLLABORATION_CONFLICT", "负责人无需申请协同自己的需求");
        }
        await this.requireNoPendingOrActiveCollaboration(tx, demand.id, input.actor.personId);
        const request = await tx.demandCollaborationRequest.create({ data: {
          demandId: demand.id,
          personId: input.actor.personId,
          requestType: "APPLY",
          status: "PENDING",
          requestedByPersonId: input.actor.personId,
          pendingKey: 1,
        } });
        await writeDemandAudit(tx, {
          actor: input.actor,
          actionCode: "DEMAND_COLLABORATION_APPLIED",
          entityType: DEMAND_ENTITY,
          entityId: demand.id,
          after: { requestId: request.id, personId: request.personId, requestType: request.requestType, status: request.status },
          context: input.context,
        });
        return { id: request.id, demandId: request.demandId, personId: request.personId, requestType: request.requestType, status: request.status };
      });
    } catch (error) {
      if (isPrismaUniqueConflict(error)) {
        throw new DemandError("DEMAND_COLLABORATION_CONFLICT", "该人员已有待处理申请/邀请或正在协同");
      }
      throw error;
    }
  }

  async inviteCollaboration(input: ServiceInput & { demandId: string; body: unknown }) {
    const command = demandCollaborationPersonSchema.parse(input.body);
    await authorizeActor({ actor: input.actor, action: "demand.collaboration.manage" });
    try {
      return await this.repository.transaction(async (tx) => {
        await this.lockDemandOrThrow(tx, input.demandId);
        const demand = await tx.demand.findUniqueOrThrow({ where: { id: input.demandId } });
        const owner = await this.requireActiveOwner(tx, demand);
        if (owner.personId !== input.actor.personId) {
          throw new PermissionError("FORBIDDEN_SCOPE", "只有当前有效负责人可以邀请协同人");
        }
        if (command.personId === owner.personId) {
          throw new DemandError("DEMAND_COLLABORATION_CONFLICT", "负责人不能邀请自己成为协同人");
        }
        const target = await this.requireEligibleCurrentMember(tx, command.personId);
        await this.requireNoPendingOrActiveCollaboration(tx, demand.id, command.personId);
        const request = await tx.demandCollaborationRequest.create({ data: {
          demandId: demand.id,
          personId: command.personId,
          requestType: "INVITE",
          status: "PENDING",
          requestedByPersonId: input.actor.personId,
          pendingKey: 1,
        } });
        await writeDemandAudit(tx, {
          actor: input.actor,
          actionCode: "DEMAND_COLLABORATION_INVITED",
          entityType: DEMAND_ENTITY,
          entityId: demand.id,
          after: { requestId: request.id, personId: request.personId, personName: target.person.name, requestType: request.requestType, status: request.status },
          context: input.context,
        });
        return { id: request.id, demandId: request.demandId, personId: request.personId, requestType: request.requestType, status: request.status };
      });
    } catch (error) {
      if (isPrismaUniqueConflict(error)) {
        throw new DemandError("DEMAND_COLLABORATION_CONFLICT", "该人员已有待处理申请/邀请或正在协同");
      }
      throw error;
    }
  }

  async approveCollaboration(input: ServiceInput & { demandId: string; personId: string; body: unknown }) {
    applyDemandCollaborationSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      await this.lockDemandOrThrow(tx, input.demandId);
      const requestId = await this.repository.lockCollaborationRequest(tx, input.demandId, input.personId);
      if (!requestId) throw new DemandError("DEMAND_COLLABORATION_NOT_FOUND", "待处理的协同申请或邀请不存在");
      const demand = await tx.demand.findUniqueOrThrow({ where: { id: input.demandId } });
      const owner = await this.requireActiveOwner(tx, demand);
      const request = await tx.demandCollaborationRequest.findUniqueOrThrow({ where: { id: requestId } });
      if (request.requestType === "APPLY") {
        await authorizeActor({ actor: input.actor, action: "demand.collaboration.manage" });
        if (owner.personId !== input.actor.personId) {
          throw new PermissionError("FORBIDDEN_SCOPE", "只有当前有效负责人可以批准协同申请");
        }
      } else {
        await authorizeActor({ actor: input.actor, action: "demand.collaboration.apply" });
        if (request.personId !== input.actor.personId) {
          throw new PermissionError("FORBIDDEN_SCOPE", "只有受邀本人可以接受协同邀请");
        }
      }
      const target = await this.requireEligibleCurrentMember(tx, request.personId);
      const existing = await tx.demandCollaborator.count({ where: {
        demandId: demand.id,
        personId: request.personId,
        status: "ACTIVE",
        activeKey: 1,
      } });
      if (existing !== 0) throw new DemandError("DEMAND_COLLABORATION_CONFLICT", "该人员已在协同中");
      const now = new Date();
      const collaborator = await tx.demandCollaborator.create({ data: {
        demandId: demand.id,
        personId: request.personId,
        sourceRequestId: request.id,
        sourceType: request.requestType,
        status: "ACTIVE",
        effectiveAt: now,
        activeKey: 1,
      } });
      await tx.demandCollaborationRequest.update({ where: { id: request.id }, data: {
        status: "ACCEPTED",
        pendingKey: null,
        decidedByPersonId: input.actor.personId,
        decidedAt: now,
      } });
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: "DEMAND_COLLABORATION_ACCEPTED",
        entityType: DEMAND_ENTITY,
        entityId: demand.id,
        after: { collaboratorId: collaborator.id, personId: collaborator.personId, personName: target.person.name, sourceType: collaborator.sourceType, status: collaborator.status },
        context: input.context,
      });
      return { id: collaborator.id, demandId: collaborator.demandId, personId: collaborator.personId, status: collaborator.status };
    });
  }

  async leaveCollaboration(input: ServiceInput & { demandId: string; body: unknown }) {
    const command = endDemandCollaborationSchema.parse(input.body);
    await authorizeActor({ actor: input.actor, action: "demand.collaboration.apply" });
    return this.repository.transaction(async (tx) => {
      await this.lockDemandOrThrow(tx, input.demandId);
      const demand = await tx.demand.findUniqueOrThrow({ where: { id: input.demandId } });
      await this.requireActiveOwner(tx, demand);
      const collaboratorId = await this.repository.lockActiveCollaborator(tx, demand.id, input.actor.personId);
      if (!collaboratorId) throw new DemandError("DEMAND_COLLABORATION_NOT_FOUND", "当前账号不是该需求的有效协同人");
      const now = new Date();
      const collaborator = await tx.demandCollaborator.update({ where: { id: collaboratorId }, data: {
        status: "LEFT",
        activeKey: null,
        expiredAt: now,
        endedReason: command.reason,
        endedByPersonId: input.actor.personId,
      } });
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: "DEMAND_COLLABORATOR_LEFT",
        entityType: DEMAND_ENTITY,
        entityId: demand.id,
        before: { collaboratorId, personId: input.actor.personId, status: "ACTIVE" },
        after: { collaboratorId, personId: input.actor.personId, status: collaborator.status },
        reason: collaborator.endedReason ?? undefined,
        context: input.context,
      });
      return { id: collaborator.id, demandId: collaborator.demandId, personId: collaborator.personId, status: collaborator.status };
    });
  }

  async removeCollaborator(input: ServiceInput & { demandId: string; personId: string; body: unknown }) {
    const command = endDemandCollaborationSchema.parse(input.body);
    await authorizeActor({ actor: input.actor, action: "demand.collaboration.manage" });
    return this.repository.transaction(async (tx) => {
      await this.lockDemandOrThrow(tx, input.demandId);
      const demand = await tx.demand.findUniqueOrThrow({ where: { id: input.demandId } });
      const owner = await this.requireActiveOwner(tx, demand);
      if (owner.personId !== input.actor.personId) {
        throw new PermissionError("FORBIDDEN_SCOPE", "只有当前有效负责人可以移除协同人");
      }
      if (input.personId === owner.personId) {
        throw new DemandError("DEMAND_COLLABORATION_CONFLICT", "负责人不能作为协同人被移除");
      }
      const collaboratorId = await this.repository.lockActiveCollaborator(tx, demand.id, input.personId);
      if (!collaboratorId) throw new DemandError("DEMAND_COLLABORATION_NOT_FOUND", "该人员不是需求的有效协同人");
      const collaborator = await tx.demandCollaborator.update({ where: { id: collaboratorId }, data: {
        status: "REMOVED",
        activeKey: null,
        expiredAt: new Date(),
        endedReason: command.reason,
        endedByPersonId: input.actor.personId,
      } });
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: "DEMAND_COLLABORATOR_REMOVED",
        entityType: DEMAND_ENTITY,
        entityId: demand.id,
        before: { collaboratorId, personId: input.personId, status: "ACTIVE" },
        after: { collaboratorId, personId: input.personId, status: collaborator.status },
        reason: collaborator.endedReason ?? undefined,
        context: input.context,
      });
      return { id: collaborator.id, demandId: collaborator.demandId, personId: collaborator.personId, status: collaborator.status };
    });
  }

  async list(input: ServiceInput & { query: unknown }) {
    const query = demandListQuerySchema.parse(input.query);
    await authorizeActor({
      actor: input.actor,
      action: "demand.view",
      resource: { resourceType: "demand", requiredScope: "GLOBAL_PUBLISHED" },
    });
    const result = await this.repository.list({
      includeAllPrePublish: input.actor.hasGlobalOperational && input.actor.capabilities.has("demand.lead.view"),
      prePublishAreaIds: input.actor.capabilities.has("demand.lead.view") ? input.actor.townshipAreaIds : [],
      status: query.status,
      demandType: query.type,
      areaId: query.areaId,
      batchId: query.batchId,
      keyword: query.keyword,
      minePersonId: query.mine ? input.actor.personId : undefined,
      page: query.page,
      pageSize: query.pageSize,
    });
    return {
      ...result,
      items: result.items.map(({ currentOwnerPerson, ...item }) => ({
        ...item,
        currentOwner: currentOwnerPerson,
      })),
    };
  }

  async detail(input: ServiceInput & { demandId: string }) {
    const demand = await this.repository.transaction((tx) => this.repository.findDemand(tx, input.demandId));
    if (!demand) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在或当前账号无权查看");
    await this.requireVisible(input.actor, demand);
    const attachments = await this.repository.transaction(async (tx) => {
      const links = await this.repository.demandAttachmentLinks(tx, demand.id);
      return links.map(({ relationType, attachment }) => ({
        id: attachment.id,
        originalFilename: attachment.originalFilename,
        actualSizeBytes: attachment.actualSizeBytes === null ? null : Number(attachment.actualSizeBytes),
        declaredMimeType: attachment.declaredMimeType,
        scanStatus: attachment.scanStatus,
        relationType,
      }));
    });
    const latestReturn = demand.reviews.find(({ decision }) => decision === "RETURN") ?? null;
    const duplicateCandidates = input.actor.capabilities.has("demand.review")
      ? await this.duplicateCandidates({ actor: input.actor, demandId: demand.id, alreadyAuthorized: true })
      : [];
    const currentOwnerPerson = demand.currentOwnerPerson;
    const collaborationRequests = demand.collaborationRequests;
    const collaborators = demand.collaborators;
    const safeDemand = {
      ...demand,
      reviews: undefined,
      currentOwnerPerson: undefined,
      ownerHistories: undefined,
      collaborationRequests: undefined,
      collaborators: undefined,
    };
    const published = isPublished(demand.status);
    const pendingCollaborationForMe = collaborationRequests.find(({ personId }) => personId === input.actor.personId) ?? null;
    const isOwner = demand.currentOwnerPersonId === input.actor.personId;
    const isAdministratorViewer = isAdministrator(input.actor) && input.actor.hasGlobalOperational;
    const visiblePendingRequests = collaborationRequests
      .filter((request) => isOwner || isAdministratorViewer || request.personId === input.actor.personId)
      .map((request) => ({
        id: request.id,
        person: request.person,
        requestType: request.requestType,
        status: request.status,
        requestedAt: request.requestedAt,
        requestedBy: request.requestedByPerson,
      }));
    const isCollaborator = collaborators.some(({ personId }) => personId === input.actor.personId);
    const myRelation = isOwner
      ? "OWNER"
      : isCollaborator
        ? "COLLABORATOR"
        : pendingCollaborationForMe?.requestType === "APPLY"
          ? "APPLIED_PENDING"
          : pendingCollaborationForMe?.requestType === "INVITE"
            ? "INVITED_PENDING"
            : "NONE";
    return {
      ...safeDemand,
      currentOwner: currentOwnerPerson,
      collaborators: collaborators.map(({ person, ...collaborator }) => ({ ...collaborator, person })),
      pendingCollaborationForMe: pendingCollaborationForMe ? {
        id: pendingCollaborationForMe.id,
        personId: pendingCollaborationForMe.personId,
        requestType: pendingCollaborationForMe.requestType,
        status: pendingCollaborationForMe.status,
        requestedAt: pendingCollaborationForMe.requestedAt,
      } : null,
      pendingCollaborationRequests: visiblePendingRequests,
      myRelation: myRelation as "NONE" | "OWNER" | "COLLABORATOR" | "APPLIED_PENDING" | "INVITED_PENDING",
      internalNote: published ? null : demand.internalNote,
      selectedContact: published && demand.contactSnapshot ? {
        id: demand.selectedContactId,
        name: demand.contactSnapshot.contactName,
        positionTitle: demand.contactSnapshot.contactPosition,
        phone: demand.contactSnapshot.contactPhone,
        status: "SNAPSHOT",
        enterpriseId: demand.enterpriseId,
      } : demand.selectedContact,
      provenances: demand.provenances.map(({ id, sourceType, createdAt, demandLead }) => ({
        id,
        sourceType,
        createdAt,
        demandLead,
      })),
      attachments,
      latestReturnReason: demand.status === "RETURNED" ? latestReturn?.returnReason ?? null : null,
      duplicateCandidates,
    };
  }

  async timeline(input: ServiceInput & { demandId: string }) {
    const demand = await this.repository.transaction((tx) => tx.demand.findUnique({ where: { id: input.demandId } }));
    if (!demand) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在或当前账号无权查看");
    await this.requireVisible(input.actor, demand);
    return this.repository.findTimeline(input.demandId);
  }

  async duplicateCandidates(input: ServiceInput & { demandId: string; alreadyAuthorized?: boolean }) {
    if (!input.alreadyAuthorized) {
      await authorizeActor({
        actor: input.actor,
        action: "demand.review",
        resource: { resourceType: "demand", requiredScope: "GLOBAL_OPERATIONAL" },
      });
    }
    const demand = await this.repository.transaction((tx) => tx.demand.findUnique({ where: { id: input.demandId } }));
    if (!demand) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
    const pool = await this.repository.findPublishedDuplicatePool(demand.enterpriseId, demand.id);
    return pool.filter((candidate) => isDeterministicDuplicateTitle(demand.title, candidate.title)).slice(0, 5);
  }
}

export { DEMAND_PRE_PUBLISH_STATUSES, DEMAND_PUBLISHED_STATUSES };
