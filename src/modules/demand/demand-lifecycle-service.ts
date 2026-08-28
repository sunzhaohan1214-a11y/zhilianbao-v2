import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { DemandProgressSourceType, Prisma } from "@/generated/prisma/client";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { OutboxRepository } from "@/modules/outbox/outbox-repository";
import { activeAdministrators, activeAreaStaff } from "@/modules/notification/recipient-resolver";
import { getCurrentMemberEligibility } from "@/modules/member-foundation/current-member-eligibility";
import { writeDemandAudit, writeDemandTransition, type DemandMutationContext } from "./audit";
import {
  getCurrentDemandResponsibilityDetailsInTransaction,
  getCurrentDemandResponsibilityInTransaction,
  getDemandProgressFreshnessInTransaction,
  shanghaiNaturalDayNumber,
  type CurrentDemandResponsibilityDetails,
} from "./demand-responsibility";
import { DemandError, isDemandCommandIdempotencyUniqueConflict } from "./errors";
import { FormalDemandRepository, type FormalDemandTransaction } from "./repository/formal-demand-repository";
import {
  addDemandProgressSchema,
  cancelDemandSchema,
  demandProgressReminderSchema,
  idempotencyKeySchema,
  previewDemandOwnerTransferSchema,
  requestDemandOwnerExitSchema,
  reviewDemandCloseSchema,
  reviewDemandOwnerExitSchema,
  submitDemandCloseSchema,
  transferDemandOwnerSchema,
} from "./schemas";

type ServiceInput = { actor: PermissionActor; context?: DemandMutationContext };
type IdempotentInput = ServiceInput & { demandId: string; idempotencyKey?: string | null };

const PROGRESS_ENTITY = "DEMAND_PROGRESS";
const CLOSE_REQUEST_ENTITY = "DEMAND_CLOSE_REQUEST";
const ATTACHMENT_RELATION = "ATTACHMENT";
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function isAdmin(actor: PermissionActor): boolean {
  return actor.effectiveRoles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN");
}

function isResponsibleTownshipStaff(actor: PermissionActor, responsibleAreaId: string): boolean {
  return actor.effectiveRoles.includes("TOWNSHIP_STAFF") && actor.townshipAreaIds.includes(responsibleAreaId);
}

function transferSecret(): string {
  const secret = process.env.AUTH_RATE_LIMIT_SECRET;
  if (!secret || secret.length < 16) throw new Error("DEMAND_HIGH_RISK_SECRET_NOT_CONFIGURED");
  return secret;
}

type TransferTokenPayload = {
  version: 1;
  actorPersonId: string;
  demandId: string;
  newOwnerPersonId: string;
  reasonHash: string;
  currentOwnerPersonId: string;
  ownerHistoryId: string;
  currentFollowBatchId: string;
  demandUpdatedAt: string;
  expiresAt: string;
};

function signTransferToken(payload: TransferTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", transferSecret()).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function verifyTransferToken(token: string): TransferTokenPayload {
  const [encoded, provided, extra] = token.split(".");
  if (!encoded || !provided || extra) throw new DemandError("DEMAND_OWNER_TRANSFER_PREVIEW_INVALID", "转交预览凭证无效，请重新预览");
  const expected = createHmac("sha256", transferSecret()).update(encoded).digest();
  let actual: Buffer;
  try { actual = Buffer.from(provided, "base64url"); } catch { throw new DemandError("DEMAND_OWNER_TRANSFER_PREVIEW_INVALID", "转交预览凭证无效，请重新预览"); }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new DemandError("DEMAND_OWNER_TRANSFER_PREVIEW_INVALID", "转交预览凭证无效，请重新预览");
  }
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as TransferTokenPayload;
    if (payload.version !== 1 || new Date(payload.expiresAt).getTime() <= Date.now()) throw new Error("expired");
    return payload;
  } catch {
    throw new DemandError("DEMAND_OWNER_TRANSFER_PREVIEW_INVALID", "转交预览已失效，请重新预览");
  }
}

export class DemandLifecycleService {
  constructor(private readonly repository = new FormalDemandRepository()) {}
  private readonly outbox = new OutboxRepository();

  private async lockDemand(tx: FormalDemandTransaction, demandId: string): Promise<void> {
    try { await this.repository.lockDemand(tx, demandId); }
    catch (error) {
      if ((error as Error).message === "DEMAND_LOCK_TARGET_NOT_FOUND") throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
      throw error;
    }
  }

  private idempotency(input: IdempotentInput, action: string, payload: unknown) {
    if (!input.idempotencyKey) throw new DemandError("DEMAND_IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key");
    const key = idempotencyKeySchema.parse(input.idempotencyKey);
    return { action, keyHash: sha256(key), payloadHash: sha256(JSON.stringify(payload)) };
  }

  private replay<T>(record: { demandId: string; payloadHash: string; responseJson: Prisma.JsonValue }, demandId: string, payloadHash: string): T {
    if (record.demandId !== demandId || record.payloadHash !== payloadHash) {
      throw new DemandError("DEMAND_IDEMPOTENCY_CONFLICT", "该 Idempotency-Key 已用于其他需求或不同请求内容");
    }
    return record.responseJson as T;
  }

  private async runIdempotent<T extends Prisma.InputJsonObject>(
    input: IdempotentInput,
    action: string,
    payload: unknown,
    operation: (tx: FormalDemandTransaction) => Promise<T>,
  ): Promise<T> {
    const identity = this.idempotency(input, action, payload);
    const attempt = () => this.repository.transaction(async (tx) => {
      await this.lockDemand(tx, input.demandId);
      const existing = await this.repository.findIdempotencyForUpdate(tx, {
        actorPersonId: input.actor.personId,
        action,
        keyHash: identity.keyHash,
      });
      if (existing) return this.replay<T>(existing, input.demandId, identity.payloadHash);
      const response = await operation(tx);
      await tx.demandCommandIdempotency.create({ data: {
        actorPersonId: input.actor.personId,
        action,
        keyHash: identity.keyHash,
        payloadHash: identity.payloadHash,
        demandId: input.demandId,
        responseJson: response,
      } });
      return response;
    });
    try { return await attempt(); }
    catch (error) {
      if (!isDemandCommandIdempotencyUniqueConflict(error)) throw error;
      const existing = await this.repository.findIdempotency({
        actorPersonId: input.actor.personId,
        action,
        keyHash: identity.keyHash,
      });
      if (!existing) throw error;
      return this.replay<T>(existing, input.demandId, identity.payloadHash);
    }
  }

  private async linkPassedAttachments(
    tx: FormalDemandTransaction,
    input: { attachmentIds: readonly string[]; actorPersonId: string; entityType: string; entityId: string },
  ): Promise<void> {
    const ids = [...new Set(input.attachmentIds)].sort();
    await this.repository.lockAttachments(tx, ids);
    if (ids.length === 0) return;
    const attachments = await tx.attachment.findMany({ where: { id: { in: ids } }, orderBy: { id: "asc" }, include: { links: true } });
    if (attachments.length !== ids.length) throw new DemandError("DEMAND_ATTACHMENT_INVALID", "附件不存在或已失效");
    for (const attachment of attachments) {
      if (
        attachment.uploadedByPersonId !== input.actorPersonId
        || !attachment.isTemporary
        || attachment.uploadStatus !== "UPLOADED"
        || attachment.scanStatus !== "PASSED"
        || !attachment.objectKey
        || attachment.links.length > 0
      ) throw new DemandError("DEMAND_ATTACHMENT_NOT_PASSED", "附件必须由当前操作人上传、安全扫描通过且尚未关联");
      await tx.attachmentLink.create({ data: {
        attachmentId: attachment.id,
        entityType: input.entityType,
        entityId: input.entityId,
        relationType: ATTACHMENT_RELATION,
        createdByPersonId: input.actorPersonId,
      } });
      await tx.attachment.update({ where: { id: attachment.id }, data: { isTemporary: false, permissionLevel: "PARENT_AUTHORIZED" } });
    }
  }

  private async demandOrThrow(tx: FormalDemandTransaction, demandId: string) {
    const demand = await tx.demand.findUnique({
      where: { id: demandId },
      select: { id: true, businessNo: true, status: true, responsibleAreaId: true, currentOwnerPersonId: true, currentFollowBatchId: true, updatedAt: true },
    });
    if (!demand) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
    return demand;
  }

  private async progressSource(
    tx: FormalDemandTransaction,
    actor: PermissionActor,
    demand: { id: string; responsibleAreaId: string },
    responsibility: CurrentDemandResponsibilityDetails,
    representedPersonId?: string,
  ): Promise<DemandProgressSourceType> {
    if (representedPersonId) {
      if (responsibility.mode !== "ALUMNI_TOWNSHIP") throw new DemandError("DEMAND_PROGRESS_NOT_ALLOWED", "当前责任模式不允许代录往届进展");
      const represented = responsibility.alumniHelpers.find((item) => item.personId === representedPersonId && item.helperKind === "HISTORICAL");
      const proxy = actor.personId === responsibility.townshipHandlerPersonId || isAdmin(actor);
      if (!represented || !proxy) throw new DemandError("DEMAND_PROGRESS_NOT_ALLOWED", "只能由当前镇区经办人或管理员代录有效历史往届进展");
      return isAdmin(actor) ? "ADMIN" : "TOWNSHIP_PROXY";
    }
    if (isAdmin(actor)) return "ADMIN";
    if (responsibility.mode === "CURRENT_OWNER") {
      if (actor.personId === responsibility.ownerPersonId) return "CURRENT_OWNER";
      const collaborator = await tx.demandCollaborator.count({ where: { demandId: demand.id, personId: actor.personId, status: "ACTIVE", activeKey: 1 } });
      if (collaborator === 1) return "COLLABORATOR";
      if (isResponsibleTownshipStaff(actor, demand.responsibleAreaId)) return "TOWNSHIP_STAFF";
    } else {
      if (actor.personId === responsibility.townshipHandlerPersonId || isResponsibleTownshipStaff(actor, demand.responsibleAreaId)) return "TOWNSHIP_STAFF";
      const helper = responsibility.alumniHelpers.find((item) => item.personId === actor.personId && item.helperKind === "PLATFORM");
      if (helper) return "ALUMNI_PLATFORM";
    }
    throw new DemandError("DEMAND_PROGRESS_NOT_ALLOWED", "当前账号不是该需求的有效进展提交人");
  }

  async addProgress(input: IdempotentInput & { body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "demand.progress.add" });
    const command = addDemandProgressSchema.parse(input.body);
    const normalized = { ...command, attachmentIds: [...new Set(command.attachmentIds)].sort() };
    return this.runIdempotent(input, "DEMAND_PROGRESS_ADD", normalized, async (tx) => {
      const demand = await this.demandOrThrow(tx, input.demandId);
      if (demand.status !== "IN_PROGRESS") throw new DemandError("DEMAND_PROGRESS_NOT_ALLOWED", "只有对接中的需求可以新增进展");
      const responsibility = await getCurrentDemandResponsibilityDetailsInTransaction(tx, demand.id);
      if (!responsibility) throw new DemandError("DEMAND_PROGRESS_RESPONSIBILITY_INVALID", "需求缺少有效责任主体");
      const sourceType = await this.progressSource(tx, input.actor, demand, responsibility, normalized.representedPersonId);
      const now = new Date();
      const progress = await tx.demandProgress.create({ data: {
        demandId: demand.id,
        currentProgress: normalized.currentProgress,
        nextStep: normalized.nextStep,
        createdByPersonId: input.actor.personId,
        sourceType,
        representedPersonId: normalized.representedPersonId,
        createdAt: now,
      } });
      await this.linkPassedAttachments(tx, { attachmentIds: normalized.attachmentIds, actorPersonId: input.actor.personId, entityType: PROGRESS_ENTITY, entityId: progress.id });
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: "DEMAND_PROGRESS_ADDED",
        entityType: "DEMAND",
        entityId: demand.id,
        after: { progressId: progress.id, sourceType, representedPersonId: normalized.representedPersonId ?? null, attachmentIds: normalized.attachmentIds },
        context: input.context,
      });
      await this.outbox.append({
        eventType: "DEMAND_PROGRESS_ADDED",
        aggregateType: "DEMAND",
        aggregateId: demand.id,
        payload: { aggregateId: demand.id, recipientIds: [], todoRecipientIds: [], eventKey: `progress:${progress.id}` },
        dedupeKey: `demand-progress-added:${progress.id}`,
        occurredAt: now,
      }, tx);
      return {
        progressId: progress.id,
        demandId: demand.id,
        sourceType,
        representedPersonId: normalized.representedPersonId ?? null,
        createdAt: now.toISOString(),
      };
    });
  }

  async remindStaleProgress(input: ServiceInput & { demandId: string; body?: unknown }) {
    await authorizeActor({ actor: input.actor, action: "demand.team_coordinator.remind", resource: { resourceType: "demand", requiredScope: "GLOBAL_PUBLISHED" } });
    demandProgressReminderSchema.parse(input.body ?? {});
    if (!input.actor.effectiveRoles.some((role) => role === "GROUP_LEADER" || role === "MINISTER")) {
      throw new DemandError("DEMAND_PROGRESS_NOT_ALLOWED", "只有当前有效团长或部长可以提醒久未更新需求");
    }
    return this.repository.transaction(async (tx) => {
      await this.lockDemand(tx, input.demandId);
      const demand = await this.demandOrThrow(tx, input.demandId);
      if (demand.status !== "IN_PROGRESS") throw new DemandError("DEMAND_PROGRESS_REMINDER_NOT_STALE", "该需求当前不参与久未更新提醒");
      const responsibility = await getCurrentDemandResponsibilityInTransaction(tx, demand.id);
      if (!responsibility) throw new DemandError("DEMAND_PROGRESS_RESPONSIBILITY_INVALID", "需求缺少有效责任主体");
      const now = new Date();
      const freshness = await getDemandProgressFreshnessInTransaction(tx, demand.id, now);
      if (!freshness.stale) throw new DemandError("DEMAND_PROGRESS_REMINDER_NOT_STALE", "该需求尚未达到久未更新条件");
      const previous = await tx.demandProgressReminder.findFirst({ where: { demandId: demand.id, reminderType: "PROGRESS_STALE" }, orderBy: [{ sentAt: "desc" }, { id: "desc" }] });
      if (previous && shanghaiNaturalDayNumber(now) - shanghaiNaturalDayNumber(previous.sentAt) < 7) {
        throw new DemandError("DEMAND_PROGRESS_REMINDER_RATE_LIMITED", "同一需求 7 个自然日内不得重复提醒", { lastSentAt: previous.sentAt.toISOString() });
      }
      const recipientPersonId = responsibility.mode === "CURRENT_OWNER" ? responsibility.ownerPersonId : responsibility.townshipHandlerPersonId;
      const reminder = await tx.demandProgressReminder.create({ data: {
        demandId: demand.id,
        reminderType: "PROGRESS_STALE",
        sentByPersonId: input.actor.personId,
        recipientPersonId,
        responsibilityMode: responsibility.mode,
        sentAt: now,
      } });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "TEAM_COORDINATOR_STALE_REMINDER", entityType: "DEMAND", entityId: demand.id, after: { reminderId: reminder.id, recipientPersonId, actorRoles: input.actor.effectiveRoles }, context: input.context });
      await this.outbox.append({
        eventType: "TEAM_COORDINATOR_STALE_REMINDER",
        aggregateType: "DEMAND",
        aggregateId: demand.id,
        payload: { aggregateId: demand.id, recipientIds: [recipientPersonId], todoRecipientIds: [recipientPersonId], eventKey: `stale-reminder:${reminder.id}` },
        dedupeKey: `demand-stale-reminder:${reminder.id}`,
        occurredAt: now,
      }, tx);
      return { reminderId: reminder.id, demandId: demand.id, recipientPersonId, sentAt: now.toISOString(), nextAllowedNaturalDay: shanghaiNaturalDayNumber(now) + 7 };
    });
  }

  private async lifecycleRecipients(
    tx: FormalDemandTransaction,
    demand: { id: string; responsibleAreaId: string },
    responsibility: CurrentDemandResponsibilityDetails,
  ) {
    const areaStaff = await activeAreaStaff(tx, demand.responsibleAreaId);
    if (responsibility.mode === "CURRENT_OWNER") {
      const collaborators = await tx.demandCollaborator.findMany({ where: { demandId: demand.id, status: "ACTIVE", activeKey: 1 }, select: { personId: true } });
      return {
        primaryPersonId: responsibility.ownerPersonId,
        recipientIds: unique([responsibility.ownerPersonId, ...collaborators.map(({ personId }) => personId), ...areaStaff]),
        collaboratorIds: collaborators.map(({ personId }) => personId),
      };
    }
    return {
      primaryPersonId: responsibility.townshipHandlerPersonId,
      recipientIds: unique([
        responsibility.townshipHandlerPersonId,
        ...responsibility.alumniHelpers.filter(({ helperKind }) => helperKind === "PLATFORM").map(({ personId }) => personId),
        ...areaStaff,
      ]),
      collaboratorIds: [] as string[],
    };
  }

  async submitClose(input: IdempotentInput & { body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "demand.close.submit" });
    const command = submitDemandCloseSchema.parse(input.body);
    const normalized = { ...command, attachmentIds: [...new Set(command.attachmentIds)].sort() };
    return this.runIdempotent(input, "DEMAND_CLOSE_SUBMIT", normalized, async (tx) => {
      const demand = await this.demandOrThrow(tx, input.demandId);
      if (demand.status !== "IN_PROGRESS") throw new DemandError("DEMAND_CLOSE_NOT_ALLOWED", "只有对接中的需求可以提交办结");
      const responsibility = await getCurrentDemandResponsibilityDetailsInTransaction(tx, demand.id);
      if (!responsibility) throw new DemandError("DEMAND_PROGRESS_RESPONSIBILITY_INVALID", "需求缺少有效责任主体");
      const authorized = responsibility.mode === "CURRENT_OWNER"
        ? input.actor.personId === responsibility.ownerPersonId
        : input.actor.personId === responsibility.townshipHandlerPersonId;
      if (!authorized) throw new DemandError("DEMAND_CLOSE_NOT_ALLOWED", "只有当前正式主责或当前镇区经办人可以提交办结");
      const [activeClose, pendingExit] = await Promise.all([
        tx.demandCloseRequest.findFirst({ where: { demandId: demand.id, activeKey: 1 } }),
        tx.demandOwnerExitRequest.findFirst({ where: { demandId: demand.id, status: "PENDING", activeKey: 1 } }),
      ]);
      if (activeClose) throw new DemandError("DEMAND_CLOSE_ALREADY_SUBMITTED", "该需求已有待审核办结申请");
      if (pendingExit) throw new DemandError("DEMAND_CLOSE_NOT_ALLOWED", "当前负责人退出申请尚未审核，不能同时提交办结");
      const latest = await tx.demandCloseRequest.aggregate({ where: { demandId: demand.id }, _max: { submissionNo: true } });
      const now = new Date();
      const closeRequest = await tx.demandCloseRequest.create({ data: {
        demandId: demand.id,
        submissionNo: (latest._max.submissionNo ?? 0) + 1,
        solution: normalized.solution,
        connectedResources: normalized.connectedResources,
        submittedByPersonId: input.actor.personId,
        responsibilityMode: responsibility.mode,
        townshipHandlerPersonId: responsibility.mode === "ALUMNI_TOWNSHIP" ? responsibility.townshipHandlerPersonId : null,
        submittedAt: now,
        activeKey: 1,
      } });
      await this.linkPassedAttachments(tx, { attachmentIds: normalized.attachmentIds, actorPersonId: input.actor.personId, entityType: CLOSE_REQUEST_ENTITY, entityId: closeRequest.id });
      await tx.demand.update({ where: { id: demand.id }, data: { status: "PENDING_CLOSE_REVIEW" } });
      await writeDemandTransition(tx, { actor: input.actor, entityType: "DEMAND", entityId: demand.id, fromState: "IN_PROGRESS", toState: "PENDING_CLOSE_REVIEW", actionCode: "DEMAND_CLOSE_SUBMITTED", metadata: { closeRequestId: closeRequest.id, submissionNo: closeRequest.submissionNo }, context: input.context });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_CLOSE_SUBMITTED", entityType: "DEMAND", entityId: demand.id, before: { status: demand.status }, after: { status: "PENDING_CLOSE_REVIEW", closeRequestId: closeRequest.id, attachmentIds: normalized.attachmentIds }, context: input.context });
      const administrators = await activeAdministrators(tx, now);
      await this.outbox.append({
        eventType: "DEMAND_CLOSE_SUBMITTED",
        aggregateType: "DEMAND",
        aggregateId: demand.id,
        payload: { aggregateId: demand.id, recipientIds: administrators, todoRecipientIds: administrators, eventKey: `close:${closeRequest.id}` },
        dedupeKey: `demand-close-submitted:${closeRequest.id}`,
        occurredAt: now,
      }, tx);
      return { closeRequestId: closeRequest.id, demandId: demand.id, submissionNo: closeRequest.submissionNo, status: "PENDING_CLOSE_REVIEW", submittedAt: now.toISOString() };
    });
  }

  async reviewClose(input: ServiceInput & { demandId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "demand.close.review", resource: { resourceType: "demand", requiredScope: "GLOBAL_OPERATIONAL" } });
    if (!isAdmin(input.actor)) throw new DemandError("DEMAND_CLOSE_NOT_ALLOWED", "只有 ADMIN / SUPER_ADMIN 可以审核办结");
    const command = reviewDemandCloseSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      await this.lockDemand(tx, input.demandId);
      const demand = await this.demandOrThrow(tx, input.demandId);
      if (demand.status !== "PENDING_CLOSE_REVIEW") throw new DemandError("DEMAND_CLOSE_REVIEW_STATE_CONFLICT", "需求当前不是待办结审核状态");
      const responsibility = await getCurrentDemandResponsibilityDetailsInTransaction(tx, demand.id);
      if (!responsibility) throw new DemandError("DEMAND_PROGRESS_RESPONSIBILITY_INVALID", "需求缺少有效责任主体");
      const active = await tx.demandCloseRequest.findFirst({ where: { demandId: demand.id, activeKey: 1 }, orderBy: { submittedAt: "desc" } });
      if (!active) throw new DemandError("DEMAND_CLOSE_REVIEW_STATE_CONFLICT", "未找到当前办结申请");
      const now = new Date();
      const review = await tx.demandCloseReview.create({ data: {
        closeRequestId: active.id,
        demandId: demand.id,
        decision: command.decision,
        townshipVerificationResult: command.townshipVerificationResult,
        reason: command.reason,
        reviewedByPersonId: input.actor.personId,
        reviewedAt: now,
      } });
      await tx.demandCloseRequest.update({ where: { id: active.id }, data: { activeKey: null, endedAt: now } });
      const recipients = await this.lifecycleRecipients(tx, demand, responsibility);
      if (command.decision === "RETURN") {
        await tx.demand.update({ where: { id: demand.id }, data: { status: "IN_PROGRESS" } });
        await writeDemandTransition(tx, { actor: input.actor, entityType: "DEMAND", entityId: demand.id, fromState: "PENDING_CLOSE_REVIEW", toState: "IN_PROGRESS", actionCode: "DEMAND_CLOSE_RETURNED", reason: command.reason, metadata: { closeRequestId: active.id, reviewId: review.id }, context: input.context });
        await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_CLOSE_RETURNED", entityType: "DEMAND", entityId: demand.id, before: { status: demand.status, closeRequestId: active.id }, after: { status: "IN_PROGRESS", reviewId: review.id }, reason: command.reason, context: input.context });
        await this.outbox.append({
          eventType: "DEMAND_CLOSE_RETURNED",
          aggregateType: "DEMAND",
          aggregateId: demand.id,
          payload: { aggregateId: demand.id, recipientIds: recipients.recipientIds, todoRecipientIds: [recipients.primaryPersonId], eventKey: `close-review:${review.id}` },
          dedupeKey: `demand-close-returned:${review.id}`,
          occurredAt: now,
        }, tx);
        return { demandId: demand.id, closeRequestId: active.id, reviewId: review.id, status: "IN_PROGRESS", decision: "RETURN", reviewedAt: now.toISOString() };
      }
      const completionBatch = await tx.batch.findUnique({ where: { id: demand.currentFollowBatchId }, select: { id: true, status: true } });
      if (!completionBatch || completionBatch.status !== "ACTIVE") throw new DemandError("DEMAND_CLOSE_REVIEW_STATE_CONFLICT", "当前跟进批次无效，不能猜测实际办结批次");
      await tx.demand.update({ where: { id: demand.id }, data: { status: "COMPLETED", completedAt: now, completionBatchId: completionBatch.id } });
      await writeDemandTransition(tx, { actor: input.actor, entityType: "DEMAND", entityId: demand.id, fromState: "PENDING_CLOSE_REVIEW", toState: "COMPLETED", actionCode: "DEMAND_COMPLETED", metadata: { closeRequestId: active.id, reviewId: review.id, completionBatchId: completionBatch.id }, context: input.context });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_COMPLETED", entityType: "DEMAND", entityId: demand.id, before: { status: demand.status }, after: { status: "COMPLETED", completedAt: now.toISOString(), completionBatchId: completionBatch.id, reviewId: review.id }, context: input.context });
      await this.outbox.append({
        eventType: "DEMAND_COMPLETED",
        aggregateType: "DEMAND",
        aggregateId: demand.id,
        payload: { aggregateId: demand.id, recipientIds: recipients.recipientIds, todoRecipientIds: [], eventKey: `close-review:${review.id}` },
        dedupeKey: `demand-completed:${review.id}`,
        occurredAt: now,
      }, tx);
      return { demandId: demand.id, closeRequestId: active.id, reviewId: review.id, status: "COMPLETED", decision: "APPROVE", completedAt: now.toISOString(), completionBatchId: completionBatch.id };
    });
  }

  async requestOwnerExit(input: IdempotentInput & { body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "demand.owner.exit_request" });
    const command = requestDemandOwnerExitSchema.parse(input.body);
    return this.runIdempotent(input, "DEMAND_OWNER_EXIT_REQUEST", command, async (tx) => {
      const demand = await this.demandOrThrow(tx, input.demandId);
      if (demand.status !== "IN_PROGRESS") throw new DemandError("DEMAND_OWNER_EXIT_NOT_ALLOWED", "只有对接中的当前正式主责可以申请退出");
      const responsibility = await getCurrentDemandResponsibilityDetailsInTransaction(tx, demand.id);
      if (!responsibility || responsibility.mode !== "CURRENT_OWNER" || responsibility.ownerPersonId !== input.actor.personId) {
        throw new DemandError("DEMAND_OWNER_EXIT_NOT_ALLOWED", "当前账号不是该需求的正式主责");
      }
      const pending = await tx.demandOwnerExitRequest.findFirst({ where: { demandId: demand.id, status: "PENDING", activeKey: 1 } });
      if (pending) throw new DemandError("DEMAND_OWNER_EXIT_ALREADY_PENDING", "该需求已有待审核负责人退出申请");
      const now = new Date();
      const request = await tx.demandOwnerExitRequest.create({ data: {
        demandId: demand.id,
        ownerPersonId: responsibility.ownerPersonId,
        ownerHistoryId: responsibility.ownerHistoryId,
        reason: command.reason,
        status: "PENDING",
        requestedAt: now,
        activeKey: 1,
      } });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_OWNER_EXIT_REQUESTED", entityType: "DEMAND", entityId: demand.id, after: { exitRequestId: request.id, ownerHistoryId: responsibility.ownerHistoryId, status: "PENDING" }, reason: command.reason, context: input.context });
      const administrators = await activeAdministrators(tx, now);
      await this.outbox.append({
        eventType: "DEMAND_OWNER_EXIT_REQUESTED",
        aggregateType: "DEMAND",
        aggregateId: demand.id,
        payload: { aggregateId: demand.id, recipientIds: administrators, todoRecipientIds: administrators, eventKey: `owner-exit:${request.id}` },
        dedupeKey: `demand-owner-exit-requested:${request.id}`,
        occurredAt: now,
      }, tx);
      return { exitRequestId: request.id, demandId: demand.id, status: "PENDING", requestedAt: now.toISOString() };
    });
  }

  async reviewOwnerExit(input: ServiceInput & { demandId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "demand.owner.exit_review", resource: { resourceType: "demand", requiredScope: "GLOBAL_OPERATIONAL" } });
    if (!isAdmin(input.actor)) throw new DemandError("DEMAND_OWNER_EXIT_REVIEW_CONFLICT", "只有 ADMIN / SUPER_ADMIN 可以审核负责人退出");
    const command = reviewDemandOwnerExitSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      await this.lockDemand(tx, input.demandId);
      const demand = await this.demandOrThrow(tx, input.demandId);
      if (demand.status !== "IN_PROGRESS") throw new DemandError("DEMAND_OWNER_EXIT_REVIEW_CONFLICT", "需求状态已变化，退出申请不能继续审核");
      const responsibility = await getCurrentDemandResponsibilityDetailsInTransaction(tx, demand.id);
      if (!responsibility || responsibility.mode !== "CURRENT_OWNER") throw new DemandError("DEMAND_OWNER_EXIT_REVIEW_CONFLICT", "需求当前不再由正式主责负责");
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM demand_owner_exit_requests
        WHERE demand_id = ${demand.id} AND status = 'PENDING' AND active_key = 1
        FOR UPDATE
      `;
      if (rows.length !== 1) throw new DemandError("DEMAND_OWNER_EXIT_REVIEW_CONFLICT", "未找到唯一待审核退出申请");
      const request = await tx.demandOwnerExitRequest.findUniqueOrThrow({ where: { id: rows[0].id } });
      if (request.ownerPersonId !== responsibility.ownerPersonId || request.ownerHistoryId !== responsibility.ownerHistoryId) {
        throw new DemandError("DEMAND_OWNER_EXIT_REVIEW_CONFLICT", "退出申请对应的负责人已变化");
      }
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM demand_owner_histories WHERE id = ${responsibility.ownerHistoryId} FOR UPDATE`;
      const now = new Date();
      if (command.decision === "REJECT") {
        await tx.demandOwnerExitRequest.update({ where: { id: request.id }, data: { status: "REJECTED", activeKey: null, reviewedAt: now, reviewedByPersonId: input.actor.personId, reviewReason: command.reviewReason } });
        await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_OWNER_EXIT_REJECTED", entityType: "DEMAND", entityId: demand.id, before: { exitRequestId: request.id, status: "PENDING" }, after: { status: "REJECTED", ownerPersonId: responsibility.ownerPersonId }, reason: command.reviewReason, context: input.context });
        await this.outbox.append({ eventType: "DEMAND_OWNER_EXIT_REJECTED", aggregateType: "DEMAND", aggregateId: demand.id, payload: { aggregateId: demand.id, recipientIds: [responsibility.ownerPersonId], todoRecipientIds: [], eventKey: `owner-exit:${request.id}` }, dedupeKey: `demand-owner-exit-rejected:${request.id}`, occurredAt: now }, tx);
        return { exitRequestId: request.id, demandId: demand.id, decision: "REJECT", status: "IN_PROGRESS", reviewedAt: now.toISOString() };
      }
      const collaborators = await tx.demandCollaborator.findMany({ where: { demandId: demand.id, status: "ACTIVE", activeKey: 1 }, select: { id: true, personId: true } });
      await tx.demandOwnerHistory.update({ where: { id: responsibility.ownerHistoryId }, data: { expiredAt: now, activeKey: null } });
      await tx.demand.update({ where: { id: demand.id }, data: { status: "PENDING_CLAIM", currentOwnerPersonId: null } });
      await tx.demandCollaborator.updateMany({ where: { demandId: demand.id, status: "ACTIVE", activeKey: 1 }, data: { status: "REMOVED", activeKey: null, expiredAt: now, endedReason: "OWNER_EXIT_APPROVED", endedByPersonId: input.actor.personId } });
      await tx.demandCollaborationRequest.updateMany({ where: { demandId: demand.id, status: "PENDING", pendingKey: 1 }, data: { status: "WITHDRAWN", pendingKey: null, decidedAt: now, decidedByPersonId: input.actor.personId } });
      await tx.demandOwnerExitRequest.update({ where: { id: request.id }, data: { status: "APPROVED", activeKey: null, reviewedAt: now, reviewedByPersonId: input.actor.personId, reviewReason: command.reviewReason } });
      await writeDemandTransition(tx, { actor: input.actor, entityType: "DEMAND", entityId: demand.id, fromState: "IN_PROGRESS", toState: "PENDING_CLAIM", actionCode: "DEMAND_OWNER_EXIT_APPROVED", reason: command.reviewReason ?? request.reason, metadata: { exitRequestId: request.id, formerOwnerPersonId: responsibility.ownerPersonId }, context: input.context });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_OWNER_EXIT_APPROVED", entityType: "DEMAND", entityId: demand.id, before: { status: "IN_PROGRESS", ownerPersonId: responsibility.ownerPersonId, ownerHistoryId: responsibility.ownerHistoryId, collaboratorIds: collaborators.map(({ personId }) => personId) }, after: { status: "PENDING_CLAIM", currentOwnerPersonId: null, collaboratorsEndedReason: "OWNER_EXIT_APPROVED" }, reason: command.reviewReason ?? request.reason, context: input.context });
      const areaStaff = await activeAreaStaff(tx, demand.responsibleAreaId, now);
      const recipients = unique([responsibility.ownerPersonId, ...collaborators.map(({ personId }) => personId), ...areaStaff]);
      await this.outbox.append({ eventType: "DEMAND_OWNER_EXIT_APPROVED", aggregateType: "DEMAND", aggregateId: demand.id, payload: { aggregateId: demand.id, recipientIds: recipients, todoRecipientIds: [], eventKey: `owner-exit:${request.id}` }, dedupeKey: `demand-owner-exit-approved:${request.id}`, occurredAt: now }, tx);
      return { exitRequestId: request.id, demandId: demand.id, decision: "APPROVE", status: "PENDING_CLAIM", reviewedAt: now.toISOString() };
    });
  }

  private assertSuperTransfer(actor: PermissionActor): void {
    if (!actor.effectiveRoles.includes("SUPER_ADMIN") || !actor.capabilities.has("demand.owner.transfer") || !actor.hasSystem) {
      throw new DemandError("DEMAND_OWNER_TRANSFER_FORBIDDEN", "只有 SUPER_ADMIN 可以转交需求负责人");
    }
  }

  private async eligibleTransferTarget(tx: FormalDemandTransaction, personId: string) {
    const eligibility = await getCurrentMemberEligibility(tx, personId);
    if (!eligibility.eligible || !eligibility.batchId || !eligibility.person) {
      throw new DemandError("DEMAND_OWNER_TRANSFER_TARGET_INVALID", "新负责人不是当前合法在任团员", { reason: eligibility.reason ?? "UNKNOWN" });
    }
    return { batchId: eligibility.batchId, person: eligibility.person };
  }

  async previewOwnerTransfer(input: ServiceInput & { demandId: string; body: unknown }) {
    this.assertSuperTransfer(input.actor);
    const command = previewDemandOwnerTransferSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      const demand = await this.demandOrThrow(tx, input.demandId);
      if (demand.status !== "IN_PROGRESS") throw new DemandError("DEMAND_OWNER_TRANSFER_STATE_CONFLICT", "只允许转交对接中的正式主责需求");
      const responsibility = await getCurrentDemandResponsibilityDetailsInTransaction(tx, demand.id);
      if (!responsibility || responsibility.mode !== "CURRENT_OWNER") throw new DemandError("DEMAND_OWNER_TRANSFER_STATE_CONFLICT", "当前需求不是正式主责模式");
      if (command.newOwnerPersonId === responsibility.ownerPersonId) throw new DemandError("DEMAND_OWNER_TRANSFER_TARGET_INVALID", "新负责人不能与原负责人相同");
      const target = await this.eligibleTransferTarget(tx, command.newOwnerPersonId);
      const [oldOwner, collaboratorCount, pendingExit] = await Promise.all([
        tx.person.findUniqueOrThrow({ where: { id: responsibility.ownerPersonId }, select: { id: true, name: true } }),
        tx.demandCollaborator.count({ where: { demandId: demand.id, status: "ACTIVE", activeKey: 1 } }),
        tx.demandOwnerExitRequest.count({ where: { demandId: demand.id, status: "PENDING", activeKey: 1 } }),
      ]);
      if (pendingExit > 0) throw new DemandError("DEMAND_OWNER_TRANSFER_STATE_CONFLICT", "当前存在待审核负责人退出申请，不能同时转交");
      const token = signTransferToken({
        version: 1,
        actorPersonId: input.actor.personId,
        demandId: demand.id,
        newOwnerPersonId: target.person.id,
        reasonHash: sha256(command.reason),
        currentOwnerPersonId: responsibility.ownerPersonId,
        ownerHistoryId: responsibility.ownerHistoryId,
        currentFollowBatchId: demand.currentFollowBatchId,
        demandUpdatedAt: demand.updatedAt.toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      });
      return {
        demandId: demand.id,
        oldOwner,
        newOwner: target.person,
        currentStatus: demand.status,
        activeCollaboratorCount: collaboratorCount,
        currentResponsibilityMode: responsibility.mode,
        currentFollowBatchId: demand.currentFollowBatchId,
        newOwnerBatchId: target.batchId,
        crossBatch: demand.currentFollowBatchId !== target.batchId,
        newOwnerEligibility: "ELIGIBLE",
        impact: ["原负责人历史永久保留", "现有协同关系继续保留", "新负责人立即接管且无需线上接受"],
        impactToken: token,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      };
    });
  }

  async transferOwner(input: IdempotentInput & { body: unknown }) {
    this.assertSuperTransfer(input.actor);
    const command = transferDemandOwnerSchema.parse(input.body);
    const normalized = { newOwnerPersonId: command.newOwnerPersonId, reason: command.reason, impactToken: command.impactToken, confirmation: command.confirmation };
    return this.runIdempotent(input, "DEMAND_OWNER_TRANSFER", normalized, async (tx) => {
      const token = verifyTransferToken(command.impactToken);
      const demand = await this.demandOrThrow(tx, input.demandId);
      if (demand.status !== "IN_PROGRESS") throw new DemandError("DEMAND_OWNER_TRANSFER_STATE_CONFLICT", "只允许转交对接中的正式主责需求");
      const responsibility = await getCurrentDemandResponsibilityDetailsInTransaction(tx, demand.id);
      if (!responsibility || responsibility.mode !== "CURRENT_OWNER") throw new DemandError("DEMAND_OWNER_TRANSFER_STATE_CONFLICT", "当前需求不是正式主责模式");
      const validToken = token.actorPersonId === input.actor.personId
        && token.demandId === demand.id
        && token.newOwnerPersonId === command.newOwnerPersonId
        && token.reasonHash === sha256(command.reason)
        && token.currentOwnerPersonId === responsibility.ownerPersonId
        && token.ownerHistoryId === responsibility.ownerHistoryId
        && token.currentFollowBatchId === demand.currentFollowBatchId
        && token.demandUpdatedAt === demand.updatedAt.toISOString();
      if (!validToken) throw new DemandError("DEMAND_OWNER_TRANSFER_PREVIEW_INVALID", "需求责任或预览内容已变化，请重新预览");
      if (command.newOwnerPersonId === responsibility.ownerPersonId) throw new DemandError("DEMAND_OWNER_TRANSFER_TARGET_INVALID", "新负责人不能与原负责人相同");
      await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM demand_owner_histories WHERE id = ${responsibility.ownerHistoryId} FOR UPDATE`;
      const pendingExit = await tx.demandOwnerExitRequest.count({ where: { demandId: demand.id, status: "PENDING", activeKey: 1 } });
      if (pendingExit > 0) throw new DemandError("DEMAND_OWNER_TRANSFER_STATE_CONFLICT", "当前存在待审核负责人退出申请，不能同时转交");
      const target = await this.eligibleTransferTarget(tx, command.newOwnerPersonId);
      const now = new Date();
      const crossBatch = demand.currentFollowBatchId !== target.batchId;
      const collaborators = await tx.demandCollaborator.findMany({ where: { demandId: demand.id, status: "ACTIVE", activeKey: 1 }, select: { personId: true } });
      await tx.demandOwnerHistory.update({ where: { id: responsibility.ownerHistoryId }, data: { expiredAt: now, activeKey: null } });
      const newHistory = await tx.demandOwnerHistory.create({ data: {
        demandId: demand.id,
        personId: target.person.id,
        batchId: target.batchId,
        effectiveAt: now,
        reason: command.reason,
        changeType: crossBatch ? "CROSS_BATCH_TRANSFER" : "TRANSFER",
        createdByPersonId: input.actor.personId,
        activeKey: 1,
      } });
      await tx.demand.update({ where: { id: demand.id }, data: {
        currentOwnerPersonId: target.person.id,
        ...(crossBatch ? { currentFollowBatchId: target.batchId, isCrossBatch: true } : {}),
      } });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_OWNER_TRANSFERRED", entityType: "DEMAND", entityId: demand.id, before: { ownerPersonId: responsibility.ownerPersonId, ownerHistoryId: responsibility.ownerHistoryId, currentFollowBatchId: demand.currentFollowBatchId }, after: { ownerPersonId: target.person.id, ownerHistoryId: newHistory.id, currentFollowBatchId: crossBatch ? target.batchId : demand.currentFollowBatchId, changeType: newHistory.changeType }, reason: command.reason, context: input.context });
      const areaStaff = await activeAreaStaff(tx, demand.responsibleAreaId, now);
      const recipients = unique([responsibility.ownerPersonId, target.person.id, ...collaborators.map(({ personId }) => personId), ...areaStaff]);
      await this.outbox.append({ eventType: "DEMAND_OWNER_TRANSFERRED", aggregateType: "DEMAND", aggregateId: demand.id, payload: { aggregateId: demand.id, recipientIds: recipients, todoRecipientIds: [], staleTodoRecipientIds: [responsibility.ownerPersonId], eventKey: `owner-transfer:${newHistory.id}` }, dedupeKey: `demand-owner-transferred:${newHistory.id}`, occurredAt: now }, tx);
      return { demandId: demand.id, status: "IN_PROGRESS", oldOwnerPersonId: responsibility.ownerPersonId, newOwnerPersonId: target.person.id, ownerHistoryId: newHistory.id, changeType: newHistory.changeType, currentFollowBatchId: crossBatch ? target.batchId : demand.currentFollowBatchId, transferredAt: now.toISOString() };
    });
  }

  async cancel(input: ServiceInput & { demandId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "demand.cancel" });
    const command = cancelDemandSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      await this.lockDemand(tx, input.demandId);
      const demand = await this.demandOrThrow(tx, input.demandId);
      if (!["PENDING_REVIEW", "RETURNED", "PENDING_CLAIM", "IN_PROGRESS", "PENDING_CLOSE_REVIEW"].includes(demand.status)) {
        throw new DemandError("DEMAND_CANCEL_NOT_ALLOWED", "该需求当前不能取消");
      }
      if (!isAdmin(input.actor) && !isResponsibleTownshipStaff(input.actor, demand.responsibleAreaId)) {
        throw new DemandError("DEMAND_CANCEL_NOT_ALLOWED", "只有负责镇区或管理员可以取消需求");
      }
      const responsibility = await getCurrentDemandResponsibilityDetailsInTransaction(tx, demand.id);
      const now = new Date();
      const related = responsibility ? await this.lifecycleRecipients(tx, demand, responsibility) : { recipientIds: await activeAreaStaff(tx, demand.responsibleAreaId, now) };
      await tx.demandOwnerHistory.updateMany({ where: { demandId: demand.id, activeKey: 1, expiredAt: null }, data: { activeKey: null, expiredAt: now } });
      await tx.demandTownshipHandler.updateMany({ where: { demandId: demand.id, activeKey: 1, expiredAt: null }, data: { activeKey: null, expiredAt: now } });
      await tx.demandAlumniHelper.updateMany({ where: { demandId: demand.id, activeKey: 1, status: "ACTIVE", expiredAt: null }, data: { activeKey: null, status: "ENDED", expiredAt: now } });
      await tx.demandCollaborator.updateMany({ where: { demandId: demand.id, status: "ACTIVE", activeKey: 1 }, data: { status: "REMOVED", activeKey: null, expiredAt: now, endedReason: "DEMAND_CANCELED", endedByPersonId: input.actor.personId } });
      await tx.demandCollaborationRequest.updateMany({ where: { demandId: demand.id, status: "PENDING", pendingKey: 1 }, data: { status: "WITHDRAWN", pendingKey: null, decidedAt: now, decidedByPersonId: input.actor.personId } });
      await tx.demandCloseRequest.updateMany({ where: { demandId: demand.id, activeKey: 1 }, data: { activeKey: null, endedAt: now } });
      await tx.demandOwnerExitRequest.updateMany({ where: { demandId: demand.id, status: "PENDING", activeKey: 1 }, data: { status: "REJECTED", activeKey: null, reviewedAt: now, reviewedByPersonId: input.actor.personId, reviewReason: "DEMAND_CANCELED" } });
      await tx.demand.update({ where: { id: demand.id }, data: { status: "CANCELED", currentOwnerPersonId: null, canceledAt: now, canceledReason: command.reason } });
      await writeDemandTransition(tx, { actor: input.actor, entityType: "DEMAND", entityId: demand.id, fromState: demand.status, toState: "CANCELED", actionCode: "DEMAND_CANCELED", reason: command.reason, context: input.context });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_CANCELED", entityType: "DEMAND", entityId: demand.id, before: { status: demand.status, currentOwnerPersonId: demand.currentOwnerPersonId }, after: { status: "CANCELED", currentOwnerPersonId: null, canceledAt: now.toISOString() }, reason: command.reason, context: input.context });
      await this.outbox.append({ eventType: "DEMAND_CANCELED", aggregateType: "DEMAND", aggregateId: demand.id, payload: { aggregateId: demand.id, recipientIds: related.recipientIds, todoRecipientIds: [], eventKey: `demand-canceled:${demand.id}` }, dedupeKey: `demand-canceled:${demand.id}`, occurredAt: now }, tx);
      return { demandId: demand.id, status: "CANCELED", canceledAt: now.toISOString() };
    });
  }

  private async transferCandidates(tx: FormalDemandTransaction) {
    const current = await tx.batch.findMany({ where: { isCurrent: true, status: "ACTIVE" }, select: { id: true }, take: 2 });
    if (current.length !== 1) return [];
    const now = new Date();
    return tx.person.findMany({
      where: {
        personStatus: "ACTIVE",
        account: { is: { status: "NORMAL", forcePasswordChange: false, confidentialityConfirmedAt: { not: null } } },
        batchMemberships: { some: { batchId: current[0].id, status: "ACTIVE", startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }] } },
        roleAssignments: { some: { roleCode: "MEMBER_CURRENT", effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] } },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 100,
      select: { id: true, name: true },
    });
  }

  async overview(input: ServiceInput & { demandId: string; now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "demand.view", resource: { resourceType: "demand", requiredScope: "GLOBAL_PUBLISHED" } });
    return this.repository.transaction(async (tx) => {
      const demand = await tx.demand.findUnique({
        where: { id: input.demandId },
        select: {
          id: true, status: true, responsibleAreaId: true, completedAt: true, completionBatchId: true, canceledAt: true, canceledReason: true,
          progressReminders: { orderBy: [{ sentAt: "desc" }, { id: "desc" }], take: 1 },
          progresses: {
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            include: { createdByPerson: { select: { id: true, name: true } }, representedPerson: { select: { id: true, name: true } } },
          },
          closeRequests: {
            orderBy: [{ submissionNo: "desc" }],
            include: {
              submittedByPerson: { select: { id: true, name: true } },
              reviews: { include: { reviewedByPerson: { select: { id: true, name: true } } } },
            },
          },
          ownerExitRequests: {
            orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
            include: { ownerPerson: { select: { id: true, name: true } }, reviewedByPerson: { select: { id: true, name: true } } },
          },
        },
      });
      if (!demand || ["DRAFT", "RETURNED", "PENDING_REVIEW"].includes(demand.status)) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在或当前账号无权查看");
      const now = input.now ?? new Date();
      const responsibility = await getCurrentDemandResponsibilityDetailsInTransaction(tx, demand.id);
      const freshness = await getDemandProgressFreshnessInTransaction(tx, demand.id, now);
      const responsibilityPersonIds = responsibility?.mode === "CURRENT_OWNER"
        ? [responsibility.ownerPersonId]
        : responsibility ? [responsibility.townshipHandlerPersonId, ...responsibility.alumniHelpers.map(({ personId }) => personId)] : [];
      const responsibilityPeople = new Map((await tx.person.findMany({ where: { id: { in: responsibilityPersonIds } }, select: { id: true, name: true } })).map((person) => [person.id, person]));
      const progressIds = demand.progresses.map(({ id }) => id);
      const closeIds = demand.closeRequests.map(({ id }) => id);
      const links = progressIds.length + closeIds.length === 0 ? [] : await tx.attachmentLink.findMany({
        where: { OR: [
          ...(progressIds.length ? [{ entityType: PROGRESS_ENTITY, entityId: { in: progressIds } }] : []),
          ...(closeIds.length ? [{ entityType: CLOSE_REQUEST_ENTITY, entityId: { in: closeIds } }] : []),
        ] },
        include: { attachment: { select: { id: true, originalFilename: true, scanStatus: true } } },
      });
      const attachments = new Map<string, Array<{ id: string; originalFilename: string; scanStatus: string }>>();
      for (const link of links) attachments.set(link.entityId, [...(attachments.get(link.entityId) ?? []), link.attachment]);
      let canAddProgress = false;
      if (demand.status === "IN_PROGRESS" && responsibility && input.actor.capabilities.has("demand.progress.add")) {
        try { await this.progressSource(tx, input.actor, demand, responsibility); canAddProgress = true; } catch { canAddProgress = false; }
      }
      const primaryPersonId = responsibility?.mode === "CURRENT_OWNER" ? responsibility.ownerPersonId : responsibility?.townshipHandlerPersonId;
      const canSubmitClose = demand.status === "IN_PROGRESS" && input.actor.capabilities.has("demand.close.submit") && input.actor.personId === primaryPersonId;
      const canRequestOwnerExit = demand.status === "IN_PROGRESS" && responsibility?.mode === "CURRENT_OWNER" && input.actor.personId === responsibility.ownerPersonId && input.actor.capabilities.has("demand.owner.exit_request") && !demand.ownerExitRequests.some(({ status, activeKey }) => status === "PENDING" && activeKey === 1);
      const canReviewClose = demand.status === "PENDING_CLOSE_REVIEW" && isAdmin(input.actor) && input.actor.capabilities.has("demand.close.review");
      const canReviewOwnerExit = demand.status === "IN_PROGRESS" && isAdmin(input.actor) && input.actor.capabilities.has("demand.owner.exit_review") && demand.ownerExitRequests.some(({ status, activeKey }) => status === "PENDING" && activeKey === 1);
      const canTransferOwner = demand.status === "IN_PROGRESS" && responsibility?.mode === "CURRENT_OWNER" && input.actor.effectiveRoles.includes("SUPER_ADMIN") && input.actor.capabilities.has("demand.owner.transfer") && input.actor.hasSystem;
      const canRemind = demand.status === "IN_PROGRESS" && freshness.stale && input.actor.capabilities.has("demand.team_coordinator.remind") && input.actor.effectiveRoles.some((role) => role === "GROUP_LEADER" || role === "MINISTER");
      const canCancel = ["PENDING_REVIEW", "RETURNED", "PENDING_CLAIM", "IN_PROGRESS", "PENDING_CLOSE_REVIEW"].includes(demand.status)
        && input.actor.capabilities.has("demand.cancel")
        && (isAdmin(input.actor) || isResponsibleTownshipStaff(input.actor, demand.responsibleAreaId));
      const historicalHelpers = responsibility?.mode === "ALUMNI_TOWNSHIP" ? responsibility.alumniHelpers.filter(({ helperKind }) => helperKind === "HISTORICAL") : [];
      const canProxyHistorical = historicalHelpers.length > 0 && responsibility?.mode === "ALUMNI_TOWNSHIP" && (input.actor.personId === responsibility.townshipHandlerPersonId || isAdmin(input.actor));
      return {
        status: demand.status,
        completedAt: demand.completedAt,
        completionBatchId: demand.completionBatchId,
        canceledAt: demand.canceledAt,
        canceledReason: demand.canceledReason,
        responsibility: responsibility ? (responsibility.mode === "CURRENT_OWNER"
          ? { mode: responsibility.mode, owner: responsibilityPeople.get(responsibility.ownerPersonId)! }
          : {
              mode: responsibility.mode,
              townshipHandler: responsibilityPeople.get(responsibility.townshipHandlerPersonId)!,
              alumniHelpers: responsibility.alumniHelpers.map(({ personId, helperKind }) => ({ ...responsibilityPeople.get(personId)!, helperKind })),
            }) : null,
        freshness,
        latestReminderAt: demand.progressReminders[0]?.sentAt ?? null,
        permissions: { canAddProgress, canSubmitClose, canRequestOwnerExit, canReviewClose, canReviewOwnerExit, canTransferOwner, canRemind, canProxyHistorical, canCancel },
        historicalProxyOptions: canProxyHistorical ? await tx.person.findMany({ where: { id: { in: historicalHelpers.map(({ personId }) => personId) } }, select: { id: true, name: true } }) : [],
        transferCandidates: canTransferOwner ? await this.transferCandidates(tx) : [],
        progresses: demand.progresses.map((progress) => ({ ...progress, attachments: attachments.get(progress.id) ?? [] })),
        closeRequests: demand.closeRequests.map((request) => ({ ...request, attachments: attachments.get(request.id) ?? [] })),
        ownerExitRequests: demand.ownerExitRequests,
      };
    });
  }
}
