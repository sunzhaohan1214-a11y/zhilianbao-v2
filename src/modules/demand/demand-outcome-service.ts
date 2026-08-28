import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { JobRepository } from "@/modules/jobs/job-repository";
import { activeAdministrators, activeAreaStaff } from "@/modules/notification/recipient-resolver";
import { OutboxRepository } from "@/modules/outbox/outbox-repository";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { writeDemandAudit, writeDemandTransition, type DemandMutationContext } from "./audit";
import { DemandError, isDemandCommandIdempotencyUniqueConflict, isPrismaUniqueConflict } from "./errors";
import { dateOnlyString, dueScheduledAt, isDateDue, parseDateOnly, shanghaiDateString } from "./outcome-date";
import {
  createOutcomeRoundSchema,
  outcomePlanSchema,
  reviewOutcomeRoundSchema,
  submitOutcomeRoundSchema,
  updateOutcomeRoundSchema,
  type OutcomePlanInput,
  type OutcomeRoundInput,
} from "./outcome-schemas";

type Tx = Prisma.TransactionClient;
type ServiceInput = { actor: PermissionActor; context?: DemandMutationContext };
type IdempotentInput = ServiceInput & { idempotencyKey?: string | null };
const ROUND_ENTITY = "DEMAND_OUTCOME_ROUND";
const EVIDENCE_RELATION = "EVIDENCE";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isAdmin(actor: PermissionActor): boolean {
  return actor.effectiveRoles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN");
}

function isResponsibleTownshipStaff(actor: PermissionActor, areaId: string): boolean {
  return actor.effectiveRoles.includes("TOWNSHIP_STAFF")
    && actor.capabilities.has("demand.outcome.fill")
    && actor.townshipAreaIds.includes(areaId);
}

function completionDate(completedAt: Date): string {
  return shanghaiDateString(completedAt);
}

function money(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function normalizeRound(command: OutcomeRoundInput) {
  return { ...command, attachmentIds: [...new Set(command.attachmentIds)].sort() };
}

function assertRoundDates(command: OutcomeRoundInput, completedAt: Date, now: Date): void {
  const completed = completionDate(completedAt);
  const today = shanghaiDateString(now);
  if (command.trackingDate < completed || command.trackingDate > today) {
    throw new DemandError("OUTCOME_STATE_CONFLICT", "实际跟踪日期必须在需求办结日期与当前上海自然日之间");
  }
  if (!command.endTracking && command.nextTrackingDate && command.nextTrackingDate <= command.trackingDate) {
    throw new DemandError("OUTCOME_STATE_CONFLICT", "下次跟踪日期必须晚于实际跟踪日期");
  }
}

async function lockDemand(tx: Tx, demandId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM demands WHERE id = ${demandId} FOR UPDATE`;
  if (rows.length !== 1) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
}

async function lockRound(tx: Tx, roundId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM demand_outcome_rounds WHERE id = ${roundId} FOR UPDATE`;
  if (rows.length !== 1) throw new DemandError("OUTCOME_NOT_FOUND", "成效跟踪轮次不存在");
}

async function linkPassedEvidence(
  tx: Tx,
  input: { attachmentIds: readonly string[]; actorPersonId: string; roundId: string },
): Promise<void> {
  const ids = [...new Set(input.attachmentIds)].sort();
  if (ids.length === 0) return;
  const placeholders = Prisma.join(ids.map((id) => Prisma.sql`${id}`));
  await tx.$queryRaw`SELECT id FROM attachments WHERE id IN (${placeholders}) ORDER BY id FOR UPDATE`;
  const attachments = await tx.attachment.findMany({ where: { id: { in: ids } }, include: { links: true } });
  if (attachments.length !== ids.length) throw new DemandError("OUTCOME_ATTACHMENT_INVALID", "佐证附件不存在或已失效");
  for (const attachment of attachments) {
    if (
      attachment.uploadedByPersonId !== input.actorPersonId
      || !attachment.isTemporary
      || attachment.uploadStatus !== "UPLOADED"
      || attachment.scanStatus !== "PASSED"
      || !attachment.objectKey
      || attachment.links.length > 0
    ) throw new DemandError("OUTCOME_ATTACHMENT_INVALID", "佐证附件必须由当前填报人上传、扫描通过且尚未关联");
    await tx.attachmentLink.create({ data: {
      attachmentId: attachment.id,
      entityType: ROUND_ENTITY,
      entityId: input.roundId,
      relationType: EVIDENCE_RELATION,
      createdByPersonId: input.actorPersonId,
    } });
    await tx.attachment.update({ where: { id: attachment.id }, data: { isTemporary: false, permissionLevel: "PARENT_AUTHORIZED" } });
  }
}

function serializePlan(plan: {
  id: string; demandId: string; trackingMode: string; status: string; firstTrackingDate: Date | null;
  nextTrackingDate: Date | null; dueVersion: number; endedAt: Date | null; decidedAt: Date;
}) {
  return {
    id: plan.id,
    demandId: plan.demandId,
    trackingMode: plan.trackingMode,
    status: plan.status,
    firstTrackingDate: plan.firstTrackingDate ? dateOnlyString(plan.firstTrackingDate) : null,
    nextTrackingDate: plan.nextTrackingDate ? dateOnlyString(plan.nextTrackingDate) : null,
    dueVersion: plan.dueVersion,
    endedAt: plan.endedAt?.toISOString() ?? null,
    decidedAt: plan.decidedAt.toISOString(),
  };
}

async function enqueueDue(tx: Tx, plan: { id: string; dueVersion: number; nextTrackingDate: Date | null }, now: Date): Promise<void> {
  if (!plan.nextTrackingDate) return;
  const dueDate = dateOnlyString(plan.nextTrackingDate);
  await new JobRepository().enqueue({
    jobType: "DEMAND_OUTCOME_DUE",
    payload: { planId: plan.id, dueVersion: plan.dueVersion, dueDate, eventKey: `outcome-due:${plan.id}:${plan.dueVersion}` },
    idempotencyKey: `demand-outcome-due:${plan.id}:${plan.dueVersion}`,
    scheduledAt: dueScheduledAt(dueDate, now),
    maxRetries: 8,
  }, tx);
}

async function cancelFutureDueJobs(tx: Tx, planId: string, now: Date): Promise<void> {
  await tx.jobTask.updateMany({
    where: {
      jobType: "DEMAND_OUTCOME_DUE",
      status: "WAITING",
      idempotencyKey: { startsWith: `demand-outcome-due:${planId}:` },
    },
    data: { status: "CANCELED", finishedAt: now },
  });
}

export async function createDemandOutcomePlanAtCompletionInTransaction(
  tx: Tx,
  input: ServiceInput & { demandId: string; completedAt: Date; decidedAt: Date; plan: OutcomePlanInput },
) {
  const existing = await tx.demandOutcomePlan.findUnique({ where: { demandId: input.demandId } });
  if (existing) throw new DemandError("OUTCOME_PLAN_ALREADY_EXISTS", "该需求已建立成效跟踪计划");
  if (input.plan.trackingMode === "TRACKING" && input.plan.firstTrackingDate < completionDate(input.completedAt)) {
    throw new DemandError("OUTCOME_STATE_CONFLICT", "首次跟踪日期不得早于需求办结日期");
  }
  const firstTrackingDate = input.plan.trackingMode === "TRACKING" ? parseDateOnly(input.plan.firstTrackingDate) : null;
  const plan = await tx.demandOutcomePlan.create({ data: {
    demandId: input.demandId,
    trackingMode: input.plan.trackingMode,
    status: input.plan.trackingMode === "TRACKING" ? "PENDING" : "NOT_TRACKED",
    firstTrackingDate,
    nextTrackingDate: firstTrackingDate,
    dueVersion: input.plan.trackingMode === "TRACKING" ? 1 : 0,
    decidedByPersonId: input.actor.personId,
    decidedAt: input.decidedAt,
  } });
  if (plan.trackingMode === "TRACKING") await enqueueDue(tx, plan, input.decidedAt);
  await writeDemandTransition(tx, {
    actor: input.actor,
    entityType: "DEMAND_OUTCOME_PLAN",
    entityId: plan.id,
    toState: plan.status,
    actionCode: "DEMAND_OUTCOME_PLAN_CREATED",
    metadata: { demandId: input.demandId, trackingMode: plan.trackingMode, dueVersion: plan.dueVersion },
    context: input.context,
  });
  await writeDemandAudit(tx, {
    actor: input.actor,
    actionCode: "DEMAND_OUTCOME_PLAN_CREATED",
    entityType: "DEMAND_OUTCOME_PLAN",
    entityId: plan.id,
    after: {
      demandId: input.demandId,
      trackingMode: plan.trackingMode,
      status: plan.status,
      firstTrackingDate: firstTrackingDate ? dateOnlyString(firstTrackingDate) : null,
      dueVersion: plan.dueVersion,
    },
    context: input.context,
  });
  return plan;
}

export async function getApprovedOutcomeTotalsInTransaction(tx: Tx, demandId: string) {
  const aggregate = await tx.demandOutcomeRound.aggregate({
    where: { demandId, reviewStatus: "APPROVED" },
    _sum: {
      contractAmountIncrement: true,
      investmentAmountIncrement: true,
      policyFundIncrement: true,
      costReductionIncrement: true,
      talentIntroducedIncrement: true,
      patentIncrement: true,
    },
  });
  return {
    contractAmount: aggregate._sum.contractAmountIncrement?.toFixed(2) ?? "0.00",
    investmentAmount: aggregate._sum.investmentAmountIncrement?.toFixed(2) ?? "0.00",
    policyFund: aggregate._sum.policyFundIncrement?.toFixed(2) ?? "0.00",
    costReduction: aggregate._sum.costReductionIncrement?.toFixed(2) ?? "0.00",
    talentIntroduced: aggregate._sum.talentIntroducedIncrement ?? 0,
    patents: aggregate._sum.patentIncrement ?? 0,
  };
}

export class DemandOutcomeService {
  private readonly prisma = getPrismaClient();
  private readonly outbox = new OutboxRepository();

  private identity(input: IdempotentInput, action: string, payload: unknown) {
    if (!input.idempotencyKey) throw new DemandError("DEMAND_IDEMPOTENCY_REQUIRED", "必须提供 Idempotency-Key");
    const key = input.idempotencyKey.trim();
    if (key.length < 8 || key.length > 191) throw new DemandError("DEMAND_IDEMPOTENCY_REQUIRED", "Idempotency-Key 格式无效");
    return { action, keyHash: sha256(key), payloadHash: sha256(JSON.stringify(payload)) };
  }

  private replay<T>(record: { demandId: string; payloadHash: string; responseJson: Prisma.JsonValue }, demandId: string, payloadHash: string): T {
    if (record.demandId !== demandId || record.payloadHash !== payloadHash) {
      throw new DemandError("OUTCOME_IDEMPOTENCY_CONFLICT", "该 Idempotency-Key 已用于其他对象或不同请求内容");
    }
    return record.responseJson as T;
  }

  private async runDemandCommand<T extends Prisma.InputJsonObject>(
    input: IdempotentInput & { demandId: string }, action: string, payload: unknown,
    operation: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    const identity = this.identity(input, action, payload);
    const attempt = () => this.prisma.$transaction(async (tx) => {
      await lockDemand(tx, input.demandId);
      const existing = await tx.demandCommandIdempotency.findFirst({ where: { actorPersonId: input.actor.personId, action, keyHash: identity.keyHash } });
      if (existing) return this.replay<T>(existing, input.demandId, identity.payloadHash);
      const response = await operation(tx);
      await tx.demandCommandIdempotency.create({ data: {
        actorPersonId: input.actor.personId, action, keyHash: identity.keyHash,
        payloadHash: identity.payloadHash, demandId: input.demandId, responseJson: response,
      } });
      return response;
    });
    try { return await attempt(); } catch (error) {
      if (!isDemandCommandIdempotencyUniqueConflict(error)) throw error;
      const existing = await this.prisma.demandCommandIdempotency.findFirst({ where: { actorPersonId: input.actor.personId, action, keyHash: identity.keyHash } });
      if (!existing) throw error;
      return this.replay<T>(existing, input.demandId, identity.payloadHash);
    }
  }

  private async demandIdForRound(roundId: string): Promise<string> {
    const round = await this.prisma.demandOutcomeRound.findUnique({ where: { id: roundId }, select: { demandId: true } });
    if (!round) throw new DemandError("OUTCOME_NOT_FOUND", "成效跟踪轮次不存在");
    return round.demandId;
  }

  private async runRoundCommand<T extends Prisma.InputJsonObject>(
    input: IdempotentInput & { roundId: string }, action: string, payload: unknown,
    operation: (tx: Tx, demandId: string) => Promise<T>,
  ): Promise<T> {
    const demandId = await this.demandIdForRound(input.roundId);
    return this.runDemandCommand({ ...input, demandId }, action, { roundId: input.roundId, ...payload as object }, async (tx) => {
      await lockRound(tx, input.roundId);
      return operation(tx, demandId);
    });
  }

  async createPlan(input: IdempotentInput & { demandId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "demand.outcome.review", resource: { resourceType: "demand", requiredScope: "GLOBAL_OPERATIONAL" } });
    if (!isAdmin(input.actor)) throw new DemandError("OUTCOME_FORBIDDEN", "只有 ADMIN / SUPER_ADMIN 可以建立成效计划");
    const command = outcomePlanSchema.parse(input.body);
    return this.runDemandCommand(input, "DEMAND_OUTCOME_PLAN_CREATE", command, async (tx) => {
      const demand = await tx.demand.findUnique({ where: { id: input.demandId }, select: { id: true, status: true, completedAt: true } });
      if (!demand) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
      if (demand.status !== "COMPLETED" || !demand.completedAt) throw new DemandError("OUTCOME_PLAN_REQUIRED", "仅可为已办结且办结时间完整的历史需求补建计划");
      const plan = await createDemandOutcomePlanAtCompletionInTransaction(tx, { ...input, completedAt: demand.completedAt, decidedAt: new Date(), plan: command });
      return serializePlan(plan);
    });
  }

  async createRound(input: IdempotentInput & { demandId: string; body: unknown; now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "demand.outcome.fill" });
    const command = normalizeRound(createOutcomeRoundSchema.parse(input.body));
    return this.runDemandCommand(input, "DEMAND_OUTCOME_ROUND_CREATE", command, async (tx) => {
      const demand = await tx.demand.findUnique({ where: { id: input.demandId }, include: { outcomePlan: true } });
      if (!demand) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
      if (!isResponsibleTownshipStaff(input.actor, demand.responsibleAreaId)) throw new DemandError("OUTCOME_FORBIDDEN", "只有负责镇区有效工作人员可以填报成效");
      if (demand.status !== "COMPLETED" || !demand.completedAt) throw new DemandError("OUTCOME_STATE_CONFLICT", "只有已办结需求可以填报成效");
      const plan = demand.outcomePlan;
      if (!plan) throw new DemandError("OUTCOME_PLAN_REQUIRED", "该需求尚未建立成效计划");
      if (plan.trackingMode !== "TRACKING") throw new DemandError("OUTCOME_NOT_TRACKED", "该需求正式决策为不跟踪");
      if (!["PENDING", "IN_PROGRESS"].includes(plan.status) || !plan.nextTrackingDate) throw new DemandError("OUTCOME_STATE_CONFLICT", "该成效计划当前不能创建新轮次");
      const now = input.now ?? new Date();
      if (!isDateDue(dateOnlyString(plan.nextTrackingDate), now)) throw new DemandError("OUTCOME_NOT_DUE", "尚未到达下次跟踪日期");
      assertRoundDates(command, demand.completedAt, now);
      const active = await tx.demandOutcomeRound.count({ where: { demandId: demand.id, activeKey: 1 } });
      if (active > 0) throw new DemandError("OUTCOME_ACTIVE_ROUND_EXISTS", "该需求已有未完成成效轮次");
      const current = await tx.batch.findMany({ where: { isCurrent: true, status: "ACTIVE" }, select: { id: true }, take: 2 });
      if (current.length !== 1) throw new DemandError("OUTCOME_BATCH_INVALID", "系统当前有效批次不是唯一值，已拒绝猜测跟踪批次");
      const latest = await tx.demandOutcomeRound.aggregate({ where: { demandId: demand.id }, _max: { roundNo: true } });
      const round = await tx.demandOutcomeRound.create({ data: {
        demandId: demand.id,
        outcomePlanId: plan.id,
        roundNo: (latest._max.roundNo ?? 0) + 1,
        trackingDate: parseDateOnly(command.trackingDate),
        trackingBatchId: current[0].id,
        contractAmountIncrement: money(command.contractAmountIncrement),
        investmentAmountIncrement: money(command.investmentAmountIncrement),
        policyFundIncrement: money(command.policyFundIncrement),
        costReductionIncrement: money(command.costReductionIncrement),
        talentIntroducedIncrement: command.talentIntroducedIncrement,
        patentIncrement: command.patentIncrement,
        qualitativeResult: command.qualitativeResult,
        enterpriseFeedback: command.enterpriseFeedback,
        nextTrackingDate: command.nextTrackingDate ? parseDateOnly(command.nextTrackingDate) : null,
        endTracking: command.endTracking,
        createdByPersonId: input.actor.personId,
      } });
      await linkPassedEvidence(tx, { attachmentIds: command.attachmentIds, actorPersonId: input.actor.personId, roundId: round.id });
      if (plan.status === "PENDING") {
        await tx.demandOutcomePlan.update({ where: { id: plan.id }, data: { status: "IN_PROGRESS" } });
        await writeDemandTransition(tx, { actor: input.actor, entityType: "DEMAND_OUTCOME_PLAN", entityId: plan.id, fromState: "PENDING", toState: "IN_PROGRESS", actionCode: "DEMAND_OUTCOME_ROUND_CREATED", metadata: { roundId: round.id }, context: input.context });
      }
      await writeDemandTransition(tx, { actor: input.actor, entityType: ROUND_ENTITY, entityId: round.id, toState: "DRAFT", actionCode: "DEMAND_OUTCOME_ROUND_CREATED", metadata: { demandId: demand.id, roundNo: round.roundNo, trackingBatchId: round.trackingBatchId }, context: input.context });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_OUTCOME_ROUND_CREATED", entityType: ROUND_ENTITY, entityId: round.id, after: {
        demandId: demand.id,
        outcomePlanId: plan.id,
        roundNo: round.roundNo,
        trackingDate: command.trackingDate,
        trackingBatchId: round.trackingBatchId,
        increments: {
          contractAmount: command.contractAmountIncrement,
          investmentAmount: command.investmentAmountIncrement,
          policyFund: command.policyFundIncrement,
          costReduction: command.costReductionIncrement,
          talentIntroduced: command.talentIntroducedIncrement,
          patents: command.patentIncrement,
        },
        qualitativeResultPresent: Boolean(command.qualitativeResult),
        enterpriseFeedbackPresent: Boolean(command.enterpriseFeedback),
        nextTrackingDate: command.nextTrackingDate,
        endTracking: command.endTracking,
        attachmentIds: command.attachmentIds,
      }, context: input.context });
      return { roundId: round.id, demandId: demand.id, roundNo: round.roundNo, reviewStatus: "DRAFT", editVersion: round.editVersion, trackingBatchId: round.trackingBatchId };
    }).catch((error) => {
      if (isPrismaUniqueConflict(error)) throw new DemandError("OUTCOME_ACTIVE_ROUND_EXISTS", "该需求已有未完成成效轮次");
      throw error;
    });
  }

  async updateRound(input: ServiceInput & { roundId: string; body: unknown; now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "demand.outcome.fill" });
    const command = updateOutcomeRoundSchema.parse(input.body);
    const normalized = normalizeRound(command);
    const demandId = await this.demandIdForRound(input.roundId);
    return this.prisma.$transaction(async (tx) => {
      await lockDemand(tx, demandId);
      await lockRound(tx, input.roundId);
      const round = await tx.demandOutcomeRound.findUniqueOrThrow({ where: { id: input.roundId }, include: { demand: { select: { responsibleAreaId: true, completedAt: true, status: true } } } });
      if (!isResponsibleTownshipStaff(input.actor, round.demand.responsibleAreaId)) throw new DemandError("OUTCOME_FORBIDDEN", "只有负责镇区有效工作人员可以修改成效草稿");
      if (round.demand.status !== "COMPLETED" || !round.demand.completedAt || !["DRAFT", "RETURNED"].includes(round.reviewStatus)) throw new DemandError("OUTCOME_STATE_CONFLICT", "该轮次当前不可修改");
      if (round.editVersion !== command.expectedVersion) throw new DemandError("OUTCOME_VERSION_CONFLICT", "成效草稿已被他人更新，请刷新后重试");
      assertRoundDates(normalized, round.demand.completedAt, input.now ?? new Date());
      const updated = await tx.demandOutcomeRound.update({ where: { id: round.id }, data: {
        trackingDate: parseDateOnly(command.trackingDate),
        contractAmountIncrement: money(command.contractAmountIncrement),
        investmentAmountIncrement: money(command.investmentAmountIncrement),
        policyFundIncrement: money(command.policyFundIncrement),
        costReductionIncrement: money(command.costReductionIncrement),
        talentIntroducedIncrement: command.talentIntroducedIncrement,
        patentIncrement: command.patentIncrement,
        qualitativeResult: command.qualitativeResult,
        enterpriseFeedback: command.enterpriseFeedback,
        nextTrackingDate: command.nextTrackingDate ? parseDateOnly(command.nextTrackingDate) : null,
        endTracking: command.endTracking,
        editVersion: { increment: 1 },
      } });
      await linkPassedEvidence(tx, { attachmentIds: command.attachmentIds, actorPersonId: input.actor.personId, roundId: round.id });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_OUTCOME_ROUND_UPDATED", entityType: ROUND_ENTITY, entityId: round.id, before: {
        editVersion: round.editVersion,
        reviewStatus: round.reviewStatus,
        trackingDate: dateOnlyString(round.trackingDate),
        increments: {
          contractAmount: round.contractAmountIncrement.toFixed(2),
          investmentAmount: round.investmentAmountIncrement.toFixed(2),
          policyFund: round.policyFundIncrement.toFixed(2),
          costReduction: round.costReductionIncrement.toFixed(2),
          talentIntroduced: round.talentIntroducedIncrement,
          patents: round.patentIncrement,
        },
        qualitativeResultPresent: Boolean(round.qualitativeResult),
        enterpriseFeedbackPresent: Boolean(round.enterpriseFeedback),
        nextTrackingDate: round.nextTrackingDate ? dateOnlyString(round.nextTrackingDate) : null,
        endTracking: round.endTracking,
      }, after: {
        editVersion: updated.editVersion,
        trackingDate: command.trackingDate,
        increments: {
          contractAmount: command.contractAmountIncrement,
          investmentAmount: command.investmentAmountIncrement,
          policyFund: command.policyFundIncrement,
          costReduction: command.costReductionIncrement,
          talentIntroduced: command.talentIntroducedIncrement,
          patents: command.patentIncrement,
        },
        qualitativeResultPresent: Boolean(command.qualitativeResult),
        enterpriseFeedbackPresent: Boolean(command.enterpriseFeedback),
        nextTrackingDate: command.nextTrackingDate,
        endTracking: command.endTracking,
        attachmentIds: command.attachmentIds,
      }, context: input.context });
      return { roundId: round.id, demandId, reviewStatus: updated.reviewStatus, editVersion: updated.editVersion };
    });
  }

  async submitRound(input: IdempotentInput & { roundId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "demand.outcome.fill" });
    const command = submitOutcomeRoundSchema.parse(input.body);
    return this.runRoundCommand(input, "DEMAND_OUTCOME_SUBMIT", command, async (tx, demandId) => {
      const round = await tx.demandOutcomeRound.findUniqueOrThrow({ where: { id: input.roundId }, include: { demand: { select: { responsibleAreaId: true, status: true } } } });
      if (!isResponsibleTownshipStaff(input.actor, round.demand.responsibleAreaId)) throw new DemandError("OUTCOME_FORBIDDEN", "只有负责镇区有效工作人员可以提交成效审核");
      if (round.demand.status !== "COMPLETED" || !["DRAFT", "RETURNED"].includes(round.reviewStatus)) throw new DemandError("OUTCOME_STATE_CONFLICT", "该轮次当前不可提交审核");
      if (round.editVersion !== command.expectedVersion) throw new DemandError("OUTCOME_VERSION_CONFLICT", "成效草稿已被他人更新，请刷新后重试");
      const now = new Date();
      const updated = await tx.demandOutcomeRound.update({ where: { id: round.id }, data: { reviewStatus: "PENDING_REVIEW", submittedByPersonId: input.actor.personId, submittedAt: now, returnReason: null, editVersion: { increment: 1 } } });
      await writeDemandTransition(tx, { actor: input.actor, entityType: ROUND_ENTITY, entityId: round.id, fromState: round.reviewStatus, toState: "PENDING_REVIEW", actionCode: "DEMAND_OUTCOME_SUBMITTED", metadata: { demandId, roundNo: round.roundNo }, context: input.context });
      await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_OUTCOME_SUBMITTED", entityType: ROUND_ENTITY, entityId: round.id, before: { reviewStatus: round.reviewStatus, editVersion: round.editVersion }, after: { reviewStatus: "PENDING_REVIEW", editVersion: updated.editVersion }, context: input.context });
      const [administrators, township] = await Promise.all([activeAdministrators(tx, now), activeAreaStaff(tx, round.demand.responsibleAreaId, now)]);
      await this.outbox.append({ eventType: "OUTCOME_SUBMITTED", aggregateType: "DEMAND", aggregateId: demandId, payload: { aggregateId: demandId, recipientIds: township, todoRecipientIds: administrators, eventKey: `outcome-submit:${round.id}:${updated.editVersion}` }, dedupeKey: `outcome-submitted:${round.id}:${updated.editVersion}`, occurredAt: now }, tx);
      return { roundId: round.id, demandId, reviewStatus: "PENDING_REVIEW", editVersion: updated.editVersion, submittedAt: now.toISOString() };
    });
  }

  async reviewRound(input: IdempotentInput & { roundId: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "demand.outcome.review", resource: { resourceType: "demand", requiredScope: "GLOBAL_OPERATIONAL" } });
    if (!isAdmin(input.actor)) throw new DemandError("OUTCOME_FORBIDDEN", "只有 ADMIN / SUPER_ADMIN 可以审核成效");
    const command = reviewOutcomeRoundSchema.parse(input.body);
    return this.runRoundCommand(input, "DEMAND_OUTCOME_REVIEW", command, async (tx, demandId) => {
      const round = await tx.demandOutcomeRound.findUniqueOrThrow({ where: { id: input.roundId }, include: { demand: { select: { responsibleAreaId: true, status: true } }, outcomePlan: true } });
      if (round.demand.status !== "COMPLETED" || round.reviewStatus !== "PENDING_REVIEW") throw new DemandError("OUTCOME_STATE_CONFLICT", "该轮次当前不是待审核状态");
      await tx.$queryRaw`SELECT id FROM demand_outcome_plans WHERE id = ${round.outcomePlanId} FOR UPDATE`;
      const now = new Date();
      const township = await activeAreaStaff(tx, round.demand.responsibleAreaId, now);
      if (command.decision === "RETURN") {
        const updated = await tx.demandOutcomeRound.update({ where: { id: round.id }, data: { reviewStatus: "RETURNED", reviewedByPersonId: input.actor.personId, reviewedAt: now, returnReason: command.reason, verifiedNote: null, editVersion: { increment: 1 } } });
        await writeDemandTransition(tx, { actor: input.actor, entityType: ROUND_ENTITY, entityId: round.id, fromState: "PENDING_REVIEW", toState: "RETURNED", actionCode: "DEMAND_OUTCOME_RETURNED", reason: command.reason, metadata: { demandId, roundNo: round.roundNo }, context: input.context });
        await writeDemandAudit(tx, { actor: input.actor, actionCode: "DEMAND_OUTCOME_RETURNED", entityType: ROUND_ENTITY, entityId: round.id, before: { reviewStatus: "PENDING_REVIEW" }, after: { reviewStatus: "RETURNED", editVersion: updated.editVersion }, reason: command.reason, context: input.context });
        await this.outbox.append({ eventType: "OUTCOME_RETURNED", aggregateType: "DEMAND", aggregateId: demandId, payload: { aggregateId: demandId, recipientIds: township, todoRecipientIds: township, eventKey: `outcome-return:${round.id}:${updated.editVersion}` }, dedupeKey: `outcome-returned:${round.id}:${updated.editVersion}`, occurredAt: now }, tx);
        return { roundId: round.id, demandId, decision: "RETURN", reviewStatus: "RETURNED", editVersion: updated.editVersion, reviewedAt: now.toISOString() };
      }
      const evidenceCount = await tx.attachmentLink.count({ where: { entityType: ROUND_ENTITY, entityId: round.id, relationType: EVIDENCE_RELATION, attachment: { scanStatus: "PASSED", uploadStatus: "UPLOADED", objectKey: { not: null } } } });
      if (evidenceCount === 0 && !command.verifiedNote) throw new DemandError("OUTCOME_VERIFICATION_REQUIRED", "无正式佐证附件时必须填写线下核实说明");
      await tx.demandOutcomeRound.update({ where: { id: round.id }, data: { reviewStatus: "APPROVED", activeKey: null, reviewedByPersonId: input.actor.personId, reviewedAt: now, returnReason: null, verifiedNote: command.verifiedNote } });
      let nextDueVersion: number | null = null;
      if (round.endTracking) {
        await tx.demandOutcomePlan.update({ where: { id: round.outcomePlanId }, data: { status: "ENDED", nextTrackingDate: null, endedAt: now } });
        await cancelFutureDueJobs(tx, round.outcomePlanId, now);
        await writeDemandTransition(tx, { actor: input.actor, entityType: "DEMAND_OUTCOME_PLAN", entityId: round.outcomePlanId, fromState: round.outcomePlan.status, toState: "ENDED", actionCode: "DEMAND_OUTCOME_TRACKING_ENDED", metadata: { roundId: round.id }, context: input.context });
      } else {
        const plan = await tx.demandOutcomePlan.update({ where: { id: round.outcomePlanId }, data: { status: "IN_PROGRESS", nextTrackingDate: round.nextTrackingDate, dueVersion: { increment: 1 } } });
        nextDueVersion = plan.dueVersion;
        await enqueueDue(tx, plan, now);
      }
      const eventType = round.endTracking ? "OUTCOME_TRACKING_ENDED" as const : "OUTCOME_APPROVED_CONTINUE" as const;
      const actionCode = round.endTracking ? "DEMAND_OUTCOME_TRACKING_ENDED" : "DEMAND_OUTCOME_APPROVED_CONTINUE";
      await writeDemandTransition(tx, { actor: input.actor, entityType: ROUND_ENTITY, entityId: round.id, fromState: "PENDING_REVIEW", toState: "APPROVED", actionCode, metadata: { demandId, roundNo: round.roundNo, trackingBatchId: round.trackingBatchId }, context: input.context });
      await writeDemandAudit(tx, { actor: input.actor, actionCode, entityType: ROUND_ENTITY, entityId: round.id, before: { reviewStatus: "PENDING_REVIEW", planStatus: round.outcomePlan.status, dueVersion: round.outcomePlan.dueVersion }, after: { reviewStatus: "APPROVED", planStatus: round.endTracking ? "ENDED" : "IN_PROGRESS", dueVersion: nextDueVersion ?? round.outcomePlan.dueVersion, evidenceCount, verifiedNotePresent: Boolean(command.verifiedNote) }, context: input.context });
      await this.outbox.append({ eventType, aggregateType: "DEMAND", aggregateId: demandId, payload: { aggregateId: demandId, recipientIds: township, todoRecipientIds: [], eventKey: `outcome-approved:${round.id}` }, dedupeKey: `outcome-approved:${round.id}`, occurredAt: now }, tx);
      return { roundId: round.id, demandId, decision: "APPROVE", reviewStatus: "APPROVED", planStatus: round.endTracking ? "ENDED" : "IN_PROGRESS", reviewedAt: now.toISOString() };
    });
  }

  async overview(input: ServiceInput & { demandId: string; now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "demand.view", resource: { resourceType: "demand", requiredScope: "GLOBAL_PUBLISHED" } });
    return this.prisma.$transaction(async (tx) => {
      const demand = await tx.demand.findUnique({ where: { id: input.demandId }, select: { id: true, status: true, responsibleAreaId: true, outcomePlan: true } });
      if (!demand || ["DRAFT", "RETURNED", "PENDING_REVIEW"].includes(demand.status)) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在或当前账号无权查看");
      const privileged = isAdmin(input.actor) || isResponsibleTownshipStaff(input.actor, demand.responsibleAreaId);
      const rounds = await tx.demandOutcomeRound.findMany({
        where: { demandId: demand.id, ...(privileged ? {} : { reviewStatus: "APPROVED" }) },
        orderBy: [{ trackingDate: "desc" }, { roundNo: "desc" }],
        include: {
          trackingBatch: { select: { id: true, name: true } },
          createdByPerson: { select: { id: true, name: true } },
          reviewedByPerson: { select: { id: true, name: true } },
        },
      });
      const links = rounds.length === 0 ? [] : await tx.attachmentLink.findMany({ where: { entityType: ROUND_ENTITY, entityId: { in: rounds.map(({ id }) => id) }, relationType: EVIDENCE_RELATION }, include: { attachment: { select: { id: true, originalFilename: true, scanStatus: true } } } });
      const attachments = new Map<string, typeof links[number]["attachment"][]>();
      for (const link of links) attachments.set(link.entityId, [...(attachments.get(link.entityId) ?? []), link.attachment]);
      const totals = await getApprovedOutcomeTotalsInTransaction(tx, demand.id);
      const active = rounds.find(({ activeKey }) => activeKey === 1);
      const now = input.now ?? new Date();
      const plan = demand.outcomePlan;
      const canCreateRound = Boolean(
        privileged && isResponsibleTownshipStaff(input.actor, demand.responsibleAreaId)
        && demand.status === "COMPLETED" && plan?.trackingMode === "TRACKING"
        && ["PENDING", "IN_PROGRESS"].includes(plan.status) && plan.nextTrackingDate
        && isDateDue(dateOnlyString(plan.nextTrackingDate), now) && !active,
      );
      return {
        plan: plan ? serializePlan(plan) : null,
        approvedTotals: totals,
        permissions: {
          canCreatePlan: demand.status === "COMPLETED" && !plan && isAdmin(input.actor) && input.actor.capabilities.has("demand.outcome.review"),
          canCreateRound,
          canReview: privileged && isAdmin(input.actor) && input.actor.capabilities.has("demand.outcome.review"),
        },
        rounds: rounds.map((round) => ({
          id: round.id,
          roundNo: round.roundNo,
          trackingDate: dateOnlyString(round.trackingDate),
          trackingBatch: round.trackingBatch,
          contractAmountIncrement: round.contractAmountIncrement.toFixed(2),
          investmentAmountIncrement: round.investmentAmountIncrement.toFixed(2),
          policyFundIncrement: round.policyFundIncrement.toFixed(2),
          costReductionIncrement: round.costReductionIncrement.toFixed(2),
          talentIntroducedIncrement: round.talentIntroducedIncrement,
          patentIncrement: round.patentIncrement,
          qualitativeResult: round.qualitativeResult,
          enterpriseFeedback: round.enterpriseFeedback,
          nextTrackingDate: round.nextTrackingDate ? dateOnlyString(round.nextTrackingDate) : null,
          endTracking: round.endTracking,
          reviewStatus: round.reviewStatus,
          returnReason: round.returnReason,
          verifiedNote: round.verifiedNote,
          editVersion: round.editVersion,
          createdByPerson: round.createdByPerson,
          reviewedByPerson: round.reviewedByPerson,
          reviewedAt: round.reviewedAt?.toISOString() ?? null,
          attachments: attachments.get(round.id) ?? [],
          permissions: {
            canUpdate: isResponsibleTownshipStaff(input.actor, demand.responsibleAreaId) && ["DRAFT", "RETURNED"].includes(round.reviewStatus),
            canSubmit: isResponsibleTownshipStaff(input.actor, demand.responsibleAreaId) && ["DRAFT", "RETURNED"].includes(round.reviewStatus),
            canReview: isAdmin(input.actor) && round.reviewStatus === "PENDING_REVIEW",
          },
        })),
      };
    });
  }
}
