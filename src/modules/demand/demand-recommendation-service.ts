import { createHash } from "node:crypto";
import type {
  DemandRecommendationCandidateKind,
  DemandRecommendationStage,
  DemandRecommendationSource,
  Prisma,
} from "@/generated/prisma/client";
import { DEMAND_MATCH_PROMPT_V1 } from "@/ai/prompts/demand-match/v1";
import { AIService, type DemandMatchEvidence } from "@/modules/ai";
import { JobRepository } from "@/modules/jobs/job-repository";
import { evaluateCurrentMemberSnapshot, getCurrentMemberEligibility } from "@/modules/member-foundation/current-member-eligibility";
import { isEffectiveWindow } from "@/modules/member-foundation/rules";
import { authorizeActor } from "@/modules/permissions/authorization";
import { PermissionError } from "@/modules/permissions/permission-errors";
import type { PermissionActor } from "@/modules/permissions/types";
import { writeDemandAudit, writeDemandTransition, type DemandMutationContext } from "./audit";
import { DEMAND_PUBLISHED_STATUSES } from "./constants";
import { DemandError } from "./errors";
import {
  getClaimDeadline,
  getDemandClaimPeriodDays,
  isAlumniFallbackEligible,
} from "./recommendation-config";
import {
  buildCandidateEvidence,
  DEMAND_MATCH_RULES_VERSION,
  deterministicRuleFallback,
  sortCandidatePool,
  sortAndLimitCandidatePool,
  toSanitizedDemandMatchInput,
  type PersistableRecommendation,
  type RecommendationCandidateFacts,
  type RecommendationDemandFacts,
} from "./recommendation-rules";
import {
  DemandRecommendationRepository,
  type DemandRecommendationTransaction,
} from "./repository/demand-recommendation-repository";
import {
  activateDemandAlumniHelpSchema,
  idempotencyKeySchema,
  manualAddDemandRecommendationSchema,
  respondDemandRecommendationSchema,
  runDemandRecommendationSchema,
} from "./schemas";

type ServiceInput = { actor: PermissionActor; context?: DemandMutationContext };

class RecommendationExecutionError extends Error {
  constructor(public readonly category: string, message: string) {
    super(message);
    this.name = "RecommendationExecutionError";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function isAdministrator(actor: PermissionActor): boolean {
  return actor.effectiveRoles.some((role) => role === "ADMIN" || role === "SUPER_ADMIN");
}

function accountIsUsable(account: { status: string; forcePasswordChange: boolean; confidentialityConfirmedAt: Date | null } | null): boolean {
  return account?.status === "NORMAL" && !account.forcePasswordChange && account.confidentialityConfirmedAt !== null;
}

function hasEffectiveRole(
  roles: readonly { roleCode: string; effectiveAt: Date; expiredAt: Date | null }[],
  roleCode: string,
  now: Date,
): boolean {
  return roles.some((role) => role.roleCode === roleCode && isEffectiveWindow(role.effectiveAt, role.expiredAt, now));
}

function hasHistoricalMembership(
  memberships: readonly { batchId: string; status: string; startDate: Date; endDate: Date | null }[],
  currentBatchId: string,
  now: Date,
): boolean {
  return memberships.some((membership) => membership.startDate <= now && (
    membership.batchId !== currentBatchId
    || membership.status !== "ACTIVE"
    || membership.endDate !== null && membership.endDate <= now
  ));
}

function safeRun(run: {
  id: string;
  stage: DemandRecommendationStage;
  status: string;
  triggerType: string;
  rulesVersion: string;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  candidateCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  errorCategory: string | null;
  createdAt: Date;
}) {
  return run;
}

function evidenceSnapshot(input: {
  evidence: DemandMatchEvidence[];
  rulesVersion: string;
  promptVersion: string | null;
  provider: string | null;
  model: string | null;
  snapshotAt: Date;
}): Prisma.InputJsonObject {
  return {
    evidence: input.evidence as unknown as Prisma.InputJsonArray,
    rulesVersion: input.rulesVersion,
    promptVersion: input.promptVersion,
    provider: input.provider,
    model: input.model,
    snapshotAt: input.snapshotAt.toISOString(),
  };
}

function parseEvidenceSnapshot(value: Prisma.JsonValue): { evidence: DemandMatchEvidence[]; rulesVersion?: string; promptVersion?: string | null; provider?: string | null; model?: string | null; snapshotAt?: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { evidence: [] };
  const record = value as Record<string, unknown>;
  return {
    evidence: Array.isArray(record.evidence) ? record.evidence as DemandMatchEvidence[] : [],
    rulesVersion: typeof record.rulesVersion === "string" ? record.rulesVersion : undefined,
    promptVersion: typeof record.promptVersion === "string" || record.promptVersion === null ? record.promptVersion : undefined,
    provider: typeof record.provider === "string" || record.provider === null ? record.provider : undefined,
    model: typeof record.model === "string" || record.model === null ? record.model : undefined,
    snapshotAt: typeof record.snapshotAt === "string" ? record.snapshotAt : undefined,
  };
}

export class DemandRecommendationService {
  constructor(
    private readonly repository = new DemandRecommendationRepository(),
    private readonly jobs = new JobRepository(),
  ) {}

  private async requireManage(input: ServiceInput, demandAreaId?: string): Promise<void> {
    await authorizeActor({
      actor: input.actor,
      action: "demand.recommendation.manage",
      resource: { resourceType: "demand", requiredScope: "GLOBAL_OPERATIONAL", areaId: demandAreaId },
    });
    if (!isAdministrator(input.actor)) throw new PermissionError("FORBIDDEN_SCOPE", "只有 ADMIN / SUPER_ADMIN 可以管理推荐");
  }

  private assertRunnableDemand(demand: { status: string; firstPublishedAt: Date | null; currentOwnerPersonId: string | null }): void {
    if (demand.status !== "PENDING_CLAIM" || !demand.firstPublishedAt || demand.currentOwnerPersonId !== null) {
      throw new DemandError("DEMAND_RECOMMENDATION_STAGE_INVALID", "仅已发布、待对接且尚无主责的需求可以运行推荐");
    }
  }

  private async fallbackEligibilityInTransaction(
    tx: DemandRecommendationTransaction,
    demand: { id: string; status: string; firstPublishedAt: Date | null; currentOwnerPersonId: string | null },
    now = new Date(),
  ): Promise<boolean> {
    const currentRun = await tx.demandRecommendationRun.findFirst({
      where: { demandId: demand.id, stage: "CURRENT", currentKey: 1 },
      include: { _count: { select: { items: true } } },
    });
    return isAlumniFallbackEligible({
      demand,
      latestCurrentRun: currentRun ? { status: currentRun.status, itemCount: currentRun._count.items } : null,
      now,
    });
  }

  async createRun(input: ServiceInput & { demandId: string; body: unknown; idempotencyKey?: string | null }) {
    const command = runDemandRecommendationSchema.parse(input.body);
    const key = idempotencyKeySchema.safeParse(input.idempotencyKey);
    if (!key.success) throw new DemandError("DEMAND_IDEMPOTENCY_REQUIRED", "运行推荐必须提供有效 Idempotency-Key");
    await this.requireManage(input);
    const action = `DEMAND_RECOMMENDATION_RUN_${command.stage}`;
    const keyHash = sha256(key.data);
    const payloadHash = sha256(JSON.stringify({ demandId: input.demandId, stage: command.stage }));
    return this.repository.transaction(async (tx) => {
      if (!await this.repository.lockDemand(tx, input.demandId)) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
      const replay = await tx.demandCommandIdempotency.findFirst({
        where: { actorPersonId: input.actor.personId, action, keyHash },
      });
      if (replay) {
        if (replay.demandId !== input.demandId || replay.payloadHash !== payloadHash) {
          throw new DemandError("DEMAND_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同推荐请求");
        }
        return replay.responseJson as { runId: string; jobId: string; stage: DemandRecommendationStage };
      }
      const demand = await tx.demand.findUniqueOrThrow({ where: { id: input.demandId } });
      this.assertRunnableDemand(demand);
      if (command.stage === "ALUMNI" && !await this.fallbackEligibilityInTransaction(tx, demand)) {
        throw new DemandError("DEMAND_RECOMMENDATION_FALLBACK_NOT_ELIGIBLE", "当前尚未满足往届补充推荐条件");
      }
      const run = await tx.demandRecommendationRun.create({ data: {
        demandId: demand.id,
        stage: command.stage,
        status: "PENDING",
        triggerType: "ADMIN",
        rulesVersion: DEMAND_MATCH_RULES_VERSION,
        promptVersion: DEMAND_MATCH_PROMPT_V1.version,
        createdByPersonId: input.actor.personId,
      } });
      const job = await this.jobs.enqueue({
        jobType: "DEMAND_RECOMMENDATION_RUN",
        payload: { runId: run.id },
        idempotencyKey: `demand-recommendation-run:${run.id}`,
        maxRetries: 3,
        priority: 10,
      }, tx);
      const result = { runId: run.id, jobId: job.id, stage: run.stage };
      await tx.demandCommandIdempotency.create({ data: {
        actorPersonId: input.actor.personId,
        action,
        keyHash,
        payloadHash,
        demandId: demand.id,
        responseJson: result,
      } });
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: "DEMAND_RECOMMENDATION_RUN_REQUESTED",
        entityType: "DEMAND",
        entityId: demand.id,
        after: { runId: run.id, jobId: job.id, stage: run.stage },
        context: input.context,
      });
      return result;
    });
  }

  private async candidatePoolForStage(demandId: string, stage: DemandRecommendationStage, now = new Date(), limitForAI = true): Promise<{
    demand: RecommendationDemandFacts;
    candidates: RecommendationCandidateFacts[];
  }> {
    const [demandRecord, currentBatchIds] = await Promise.all([
      this.repository.loadDemandFacts(demandId),
      this.repository.currentActiveBatchIds(),
    ]);
    if (!demandRecord) throw new RecommendationExecutionError("DEMAND_NOT_FOUND", "Demand no longer exists");
    if (currentBatchIds.length !== 1) throw new RecommendationExecutionError("CURRENT_ACTIVE_BATCH_COUNT_INVALID", "Exactly one current active batch is required");
    const currentBatchId = currentBatchIds[0];
    const [people, declined] = await Promise.all([
      this.repository.listCandidatePeople(stage === "CURRENT" ? currentBatchId : undefined),
      this.repository.declinedPersonIds(demandId, stage),
    ]);
    const demand: RecommendationDemandFacts = {
      demandId: demandRecord.id,
      title: demandRecord.title,
      originalDescription: demandRecord.originalDescription,
      demandType: demandRecord.demandType,
      enterpriseEvidence: {
        mainProducts: demandRecord.enterprise.mainProducts,
        industries: demandRecord.enterprise.tagRelations.map(({ tag }) => tag.name),
      },
    };
    const eligiblePeople = people.flatMap((person) => {
      if (declined.has(person.id)) return [];
      const current = evaluateCurrentMemberSnapshot(person, currentBatchId, now);
      let candidateKind: DemandRecommendationCandidateKind | null = null;
      if (stage === "CURRENT") {
        if (!current.eligible) return [];
        candidateKind = "CURRENT";
      } else {
        if (current.eligible) return [];
        if (
          accountIsUsable(person.account)
          && hasEffectiveRole(person.roleAssignments, "MEMBER_ALUMNI_PLATFORM", now)
          && person.batchMemberships.length > 0
        ) {
          candidateKind = "ALUMNI_PLATFORM";
        } else if (person.account === null && hasHistoricalMembership(person.batchMemberships, currentBatchId, now)) {
          candidateKind = "ALUMNI_HISTORICAL";
        }
      }
      return candidateKind ? [{ person, candidateKind }] : [];
    });
    const operational = await this.repository.operationalFacts(eligiblePeople.map(({ person }) => person.id), now);
    const candidates = eligiblePeople.map(({ person, candidateKind }) => {
      const profile = person.memberCapabilityProfile;
      const facts = operational.get(person.id) ?? { currentOwnedDemandCount: 0, recentTripCount: 0, lastActivityAt: null };
      const base = {
        candidateId: person.id,
        name: person.name,
        candidateKind,
        profileId: profile?.id ?? null,
        professionalDirection: profile?.professionalDirection ?? null,
        industries: profile?.industries.map(({ industry }) => industry.name) ?? [],
        coordinatableResources: profile?.coordinatableResources ?? null,
        preferredDemandTypes: profile?.preferredDemandTypes.map(({ demandType }) => demandType) ?? [],
        personalIntroduction: profile?.personalIntroduction ?? null,
        currentOwnedDemandCount: facts.currentOwnedDemandCount,
        recentActivity: { recentTripCount: facts.recentTripCount, lastActivityAt: facts.lastActivityAt?.toISOString() ?? null },
      };
      const scored = buildCandidateEvidence({ candidate: base, demand });
      return { ...base, ...scored } satisfies RecommendationCandidateFacts;
    });
    return { demand, candidates: limitForAI ? sortAndLimitCandidatePool(candidates) : sortCandidatePool(candidates) };
  }

  private async candidatePool(runId: string, now = new Date()): Promise<{
    run: { id: string; demandId: string; stage: DemandRecommendationStage };
    demand: RecommendationDemandFacts;
    candidates: RecommendationCandidateFacts[];
  }> {
    const run = await this.repository.transaction((tx) => tx.demandRecommendationRun.findUnique({
      where: { id: runId },
      select: { id: true, demandId: true, stage: true },
    }));
    if (!run) throw new RecommendationExecutionError("RUN_NOT_FOUND", "Recommendation run no longer exists");
    return { run, ...await this.candidatePoolForStage(run.demandId, run.stage, now) };
  }

  private async markRunFailed(runId: string, category: string): Promise<void> {
    await this.repository.transaction(async (tx) => {
      if (!await this.repository.lockRun(tx, runId)) return;
      const run = await tx.demandRecommendationRun.findUniqueOrThrow({ where: { id: runId } });
      if (["SUCCEEDED", "FALLBACK_SUCCEEDED", "FAILED"].includes(run.status)) return;
      await tx.demandRecommendationRun.update({
        where: { id: runId },
        data: { status: "FAILED", finishedAt: new Date(), currentKey: null, errorCategory: category.slice(0, 100) },
      });
    });
  }

  private async validateAlumniCandidate(
    tx: DemandRecommendationTransaction,
    personId: string,
    expectedKind?: DemandRecommendationCandidateKind,
    now = new Date(),
  ): Promise<DemandRecommendationCandidateKind> {
    await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM batches ORDER BY id FOR UPDATE`;
    const batches = await tx.batch.findMany({ where: { isCurrent: true, status: "ACTIVE" }, select: { id: true }, take: 2 });
    if (batches.length !== 1) throw new DemandError("DEMAND_RECOMMENDATION_STAGE_INVALID", "当前活动批次配置异常");
    if (!await this.repository.lockPerson(tx, personId)) throw new DemandError("DEMAND_RECOMMENDATION_ITEM_NOT_FOUND", "推荐人员不存在");
    await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM accounts WHERE person_id = ${personId} FOR UPDATE`;
    const person = await tx.person.findUnique({
      where: { id: personId },
      select: {
        id: true,
        name: true,
        personStatus: true,
        account: { select: { status: true, forcePasswordChange: true, confidentialityConfirmedAt: true } },
        batchMemberships: { select: { batchId: true, status: true, startDate: true, endDate: true } },
        roleAssignments: { select: { roleCode: true, effectiveAt: true, expiredAt: true } },
      },
    });
    if (!person || person.personStatus !== "ACTIVE") throw new DemandError("DEMAND_RECOMMENDATION_ITEM_NOT_FOUND", "推荐人员档案无效");
    if (evaluateCurrentMemberSnapshot(person, batches[0].id, now).eligible) {
      throw new DemandError("DEMAND_RECOMMENDATION_STAGE_INVALID", "当前合法在任团员不能进入往届推荐");
    }
    let kind: DemandRecommendationCandidateKind | null = null;
    if (accountIsUsable(person.account) && hasEffectiveRole(person.roleAssignments, "MEMBER_ALUMNI_PLATFORM", now) && person.batchMemberships.length > 0) {
      kind = "ALUMNI_PLATFORM";
    } else if (person.account === null && hasHistoricalMembership(person.batchMemberships, batches[0].id, now)) {
      kind = "ALUMNI_HISTORICAL";
    }
    if (!kind || expectedKind && kind !== expectedKind) throw new DemandError("DEMAND_RECOMMENDATION_STAGE_INVALID", "人员不具备合法往届候选资格");
    return kind;
  }

  private async activateComputedRun(input: {
    runId: string;
    candidateCount: number;
    recommendations: PersistableRecommendation[];
    status: "SUCCEEDED" | "FALLBACK_SUCCEEDED";
    provider: string;
    model: string;
    promptVersion: string;
    durationMs: number;
    errorCategory?: string;
  }): Promise<void> {
    const located = await this.repository.transaction((tx) => tx.demandRecommendationRun.findUnique({
      where: { id: input.runId },
      select: { demandId: true },
    }));
    if (!located) throw new RecommendationExecutionError("RUN_NOT_FOUND", "Recommendation run no longer exists");
    await this.repository.transaction(async (tx) => {
      if (!await this.repository.lockDemand(tx, located.demandId)) throw new RecommendationExecutionError("DEMAND_NOT_FOUND", "Demand no longer exists");
      if (!await this.repository.lockRun(tx, input.runId)) throw new RecommendationExecutionError("RUN_NOT_FOUND", "Recommendation run no longer exists");
      const run = await tx.demandRecommendationRun.findUniqueOrThrow({ where: { id: input.runId } });
      if (["SUCCEEDED", "FALLBACK_SUCCEEDED"].includes(run.status)) return;
      const demand = await tx.demand.findUniqueOrThrow({ where: { id: run.demandId } });
      try {
        this.assertRunnableDemand(demand);
      } catch {
        throw new RecommendationExecutionError("DEMAND_STATE_CHANGED", "Demand changed while recommendation was running");
      }
      if (run.stage === "ALUMNI" && !await this.fallbackEligibilityInTransaction(tx, demand)) {
        throw new RecommendationExecutionError("ALUMNI_FALLBACK_NOT_ELIGIBLE", "Alumni fallback gate changed while recommendation was running");
      }
      const validRecommendations: PersistableRecommendation[] = [];
      for (const recommendation of input.recommendations.slice(0, 3)) {
        if (run.stage === "CURRENT") {
          const eligibility = await getCurrentMemberEligibility(tx, recommendation.personId);
          if (!eligibility.eligible || recommendation.candidateKind !== "CURRENT") continue;
        } else {
          try {
            await this.validateAlumniCandidate(tx, recommendation.personId, recommendation.candidateKind);
          } catch {
            continue;
          }
        }
        validRecommendations.push(recommendation);
      }
      const snapshotAt = new Date();
      for (const [index, recommendation] of validRecommendations.entries()) {
        await tx.demandRecommendationItem.create({ data: {
          runId: run.id,
          personId: recommendation.personId,
          candidateKind: recommendation.candidateKind,
          rank: index + 1,
          source: recommendation.source,
          reason: recommendation.reason,
          evidenceSnapshotJson: evidenceSnapshot({
            evidence: recommendation.evidence,
            rulesVersion: run.rulesVersion,
            promptVersion: input.promptVersion,
            provider: input.provider,
            model: input.model,
            snapshotAt,
          }),
        } });
      }
      await tx.demandRecommendationRun.updateMany({
        where: { demandId: run.demandId, stage: run.stage, currentKey: 1, id: { not: run.id } },
        data: { currentKey: null },
      });
      await tx.demandRecommendationRun.update({ where: { id: run.id }, data: {
        status: validRecommendations.length === 0 && input.status === "FALLBACK_SUCCEEDED" ? "SUCCEEDED" : input.status,
        provider: input.provider,
        model: input.model,
        promptVersion: input.promptVersion,
        candidateCount: input.candidateCount,
        currentKey: 1,
        finishedAt: snapshotAt,
        durationMs: input.durationMs,
        errorCategory: input.errorCategory,
      } });
    });
  }

  async executeRun(runId: string, aiService = new AIService()): Promise<void> {
    try {
      const alreadyDone = await this.repository.transaction(async (tx) => {
        if (!await this.repository.lockRun(tx, runId)) throw new RecommendationExecutionError("RUN_NOT_FOUND", "Recommendation run no longer exists");
        const run = await tx.demandRecommendationRun.findUniqueOrThrow({ where: { id: runId } });
        if (["SUCCEEDED", "FALLBACK_SUCCEEDED"].includes(run.status)) return true;
        if (run.status === "FAILED") throw new RecommendationExecutionError(run.errorCategory ?? "RUN_FAILED", "Recommendation run already failed");
        await tx.demandRecommendationRun.update({ where: { id: run.id }, data: { status: "RUNNING", startedAt: run.startedAt ?? new Date() } });
        return false;
      });
      if (alreadyDone) return;
      const pool = await this.candidatePool(runId);
      const sanitizedInput = toSanitizedDemandMatchInput(pool.demand, pool.candidates);
      const ai = await aiService.rankDemandCandidates(sanitizedInput);
      let recommendations: PersistableRecommendation[];
      let status: "SUCCEEDED" | "FALLBACK_SUCCEEDED";
      let errorCategory: string | undefined;
      if (ai.ok) {
        const candidates = new Map(pool.candidates.map((candidate) => [candidate.candidateId, candidate]));
        recommendations = ai.output.recommendations.flatMap((item) => {
          const candidate = candidates.get(item.candidateId);
          if (!candidate) return [];
          const cited = candidate.evidence.filter(({ key }) => item.evidenceKeys.includes(key));
          return [{ personId: candidate.candidateId, candidateKind: candidate.candidateKind, source: "AI" as const, reason: item.reason, evidence: cited }];
        });
        status = "SUCCEEDED";
      } else {
        recommendations = deterministicRuleFallback(pool.candidates);
        status = recommendations.length > 0 ? "FALLBACK_SUCCEEDED" : "SUCCEEDED";
        errorCategory = ai.errorCategory;
      }
      await this.activateComputedRun({
        runId,
        candidateCount: pool.candidates.length,
        recommendations,
        status,
        provider: ai.provider,
        model: ai.model,
        promptVersion: ai.promptVersion,
        durationMs: ai.durationMs,
        errorCategory,
      });
    } catch (error) {
      const category = error instanceof RecommendationExecutionError ? error.category : "RECOMMENDATION_EXECUTION_FAILED";
      await this.markRunFailed(runId, category);
      throw error;
    }
  }

  async getRecommendations(input: ServiceInput & { demandId: string }) {
    const demand = await this.repository.transaction((tx) => tx.demand.findUnique({
      where: { id: input.demandId },
      select: { id: true, status: true, responsibleAreaId: true, firstPublishedAt: true, currentOwnerPersonId: true },
    }));
    if (!demand || !DEMAND_PUBLISHED_STATUSES.has(demand.status)) throw new DemandError("DEMAND_RECOMMENDATION_NOT_VISIBLE", "推荐不存在或当前账号不可见");
    await authorizeActor({ actor: input.actor, action: "demand.view", resource: { resourceType: "demand", requiredScope: "GLOBAL_PUBLISHED" } });
    const fullViewer = isAdministrator(input.actor) || input.actor.townshipAreaIds.includes(demand.responsibleAreaId);
    const currentRuns = await this.repository.transaction((tx) => tx.demandRecommendationRun.findMany({
      where: { demandId: demand.id, currentKey: 1 },
      orderBy: [{ stage: "asc" }, { createdAt: "desc" }],
      include: {
        _count: { select: { items: true } },
        items: {
          where: fullViewer ? {} : { personId: input.actor.personId },
          orderBy: [{ rank: "asc" }, { id: "asc" }],
          include: { person: { select: { id: true, name: true } } },
        },
      },
    }));
    const visibleRuns = fullViewer ? currentRuns : currentRuns.filter(({ items }) => items.length > 0);
    const selected = fullViewer
      ? visibleRuns.find(({ stage }) => stage === "ALUMNI") ?? visibleRuns.find(({ stage }) => stage === "CURRENT") ?? null
      : visibleRuns[0] ?? null;
    const currentRunForGate = currentRuns.find(({ stage }) => stage === "CURRENT") ?? null;
    const activeAlumniPath = demand.status === "IN_PROGRESS" && demand.currentOwnerPersonId === null
      ? await this.repository.transaction((tx) => tx.demandTownshipHandler.count({ where: { demandId: demand.id, activeKey: 1, expiredAt: null } })).then((count) => count === 1)
      : false;
    const alumniResponseOpen = demand.status === "PENDING_CLAIM" || activeAlumniPath;
    const mapItem = (item: (typeof currentRuns)[number]["items"][number]) => ({
      id: item.id,
      person: item.person,
      candidateKind: item.candidateKind,
      rank: item.rank,
      source: item.source,
      reason: item.reason,
      evidenceSnapshot: parseEvidenceSnapshot(item.evidenceSnapshotJson),
      responseStatus: item.responseStatus,
      respondedAt: item.respondedAt,
      responseNote: fullViewer ? item.responseNote : null,
      canDecline: item.personId === input.actor.personId && (item.candidateKind === "CURRENT" ? demand.status === "PENDING_CLAIM" : alumniResponseOpen) && !item.responseStatus,
      canWilling: item.personId === input.actor.personId && item.candidateKind === "ALUMNI_PLATFORM" && alumniResponseOpen && !item.responseStatus,
      canRecordOffline: fullViewer && item.candidateKind === "ALUMNI_HISTORICAL" && alumniResponseOpen && !item.responseStatus,
      canActivate: isAdministrator(input.actor) && item.candidateKind !== "CURRENT" && item.responseStatus === "WILLING",
    });
    const runHistory = isAdministrator(input.actor) ? await this.repository.transaction((tx) => tx.demandRecommendationRun.findMany({
      where: { demandId: demand.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true, stage: true, status: true, triggerType: true, rulesVersion: true, promptVersion: true,
        provider: true, model: true, candidateCount: true, startedAt: true, finishedAt: true,
        durationMs: true, errorCategory: true, createdAt: true,
      },
    })) : [];
    const handlerOptions = isAdministrator(input.actor) ? await this.listTownshipHandlerOptions(demand.responsibleAreaId) : [];
    const responsibility = fullViewer ? await this.getCurrentDemandResponsibility(demand.id) : null;
    return {
      currentRun: selected ? safeRun(selected) : null,
      items: selected?.items.map(mapItem) ?? [],
      currentRuns: visibleRuns.map((run) => ({ ...safeRun(run), items: run.items.map(mapItem) })),
      runHistory,
      townshipHandlerOptions: handlerOptions,
      claimDeadlineAt: getClaimDeadline(demand),
      alumniFallbackEligible: isAlumniFallbackEligible({
        demand,
        latestCurrentRun: currentRunForGate ? { status: currentRunForGate.status, itemCount: currentRunForGate._count.items } : null,
      }),
      demandAlreadyClaimed: demand.status !== "PENDING_CLAIM" || demand.currentOwnerPersonId !== null,
      responsibility,
      canManage: isAdministrator(input.actor),
      canRecordHistoricalResponse: fullViewer,
      canActivateAlumniHelp: isAdministrator(input.actor),
    };
  }

  async respond(input: ServiceInput & { demandId: string; itemId: string; body: unknown }) {
    const command = respondDemandRecommendationSchema.parse(input.body);
    const located = await this.repository.transaction((tx) => tx.demandRecommendationItem.findUnique({
      where: { id: input.itemId },
      select: { run: { select: { demandId: true } } },
    }));
    if (!located || located.run.demandId !== input.demandId) throw new DemandError("DEMAND_RECOMMENDATION_ITEM_NOT_FOUND", "推荐项不存在");
    return this.repository.transaction(async (tx) => {
      if (!await this.repository.lockDemand(tx, input.demandId)) throw new DemandError("DEMAND_RECOMMENDATION_ITEM_NOT_FOUND", "推荐项不存在");
      if (!await this.repository.lockItem(tx, input.itemId)) throw new DemandError("DEMAND_RECOMMENDATION_ITEM_NOT_FOUND", "推荐项不存在");
      const item = await tx.demandRecommendationItem.findUniqueOrThrow({
        where: { id: input.itemId },
        include: { run: true },
      });
      const demand = await tx.demand.findUniqueOrThrow({ where: { id: input.demandId } });
      const alumniPathActive = item.run.stage === "ALUMNI"
        && demand.status === "IN_PROGRESS"
        && demand.currentOwnerPersonId === null
        && await tx.demandTownshipHandler.count({ where: { demandId: demand.id, activeKey: 1, expiredAt: null } }) === 1;
      const responseStateValid = demand.status === "PENDING_CLAIM" && demand.currentOwnerPersonId === null || alumniPathActive;
      if (item.run.demandId !== demand.id || item.run.currentKey !== 1 || !responseStateValid) {
        throw new DemandError("DEMAND_RECOMMENDATION_RESPONSE_INVALID", "该推荐项当前不可响应");
      }
      const fullViewer = isAdministrator(input.actor) || input.actor.townshipAreaIds.includes(demand.responsibleAreaId);
      if (item.candidateKind === "CURRENT") {
        if (item.personId !== input.actor.personId || command.response !== "DECLINE") {
          throw new DemandError("DEMAND_RECOMMENDATION_RESPONSE_INVALID", "在任推荐仅本人可选择暂不参与");
        }
      } else if (item.candidateKind === "ALUMNI_PLATFORM") {
        if (item.personId !== input.actor.personId) throw new DemandError("DEMAND_RECOMMENDATION_RESPONSE_INVALID", "平台内往届推荐仅本人可响应");
      } else if (!fullViewer || !command.responseNote) {
        throw new DemandError("DEMAND_RECOMMENDATION_RESPONSE_INVALID", "历史往届反馈必须由管理员或负责镇区登记并填写线下联系说明");
      }
      if (item.responseStatus) {
        if (item.responseStatus === command.response) return { itemId: item.id, responseStatus: item.responseStatus, respondedAt: item.respondedAt };
        throw new DemandError("DEMAND_RECOMMENDATION_ALREADY_DECLINED", "该推荐项已经记录响应，不能覆盖历史");
      }
      const updated = await tx.demandRecommendationItem.update({ where: { id: item.id }, data: {
        responseStatus: command.response,
        respondedAt: new Date(),
        respondedByPersonId: input.actor.personId,
        responseNote: command.responseNote,
      } });
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: item.candidateKind === "ALUMNI_HISTORICAL" ? "DEMAND_RECOMMENDATION_OFFLINE_RESPONSE_RECORDED" : "DEMAND_RECOMMENDATION_RESPONDED",
        entityType: "DEMAND",
        entityId: demand.id,
        after: { itemId: item.id, personId: item.personId, candidateKind: item.candidateKind, responseStatus: updated.responseStatus },
        reason: command.responseNote,
        context: input.context,
      });
      return { itemId: updated.id, responseStatus: updated.responseStatus, respondedAt: updated.respondedAt };
    });
  }

  private async candidateForManual(stage: DemandRecommendationStage, demandId: string, personId: string): Promise<RecommendationCandidateFacts | null> {
    const pool = await this.candidatePoolForStage(demandId, stage, new Date(), false);
    return pool.candidates.find((candidate) => candidate.candidateId === personId) ?? null;
  }

  async manualAdd(input: ServiceInput & { demandId: string; body: unknown }) {
    const command = manualAddDemandRecommendationSchema.parse(input.body);
    await this.requireManage(input);
    const candidate = await this.candidateForManual(command.stage, input.demandId, command.personId);
    if (!candidate) throw new DemandError("DEMAND_RECOMMENDATION_STAGE_INVALID", "人工推荐对象不具备当前阶段实时资格，或已明确暂不参与");
    return this.repository.transaction(async (tx) => {
      if (!await this.repository.lockDemand(tx, input.demandId)) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
      const demand = await tx.demand.findUniqueOrThrow({ where: { id: input.demandId } });
      this.assertRunnableDemand(demand);
      if (command.stage === "ALUMNI" && !await this.fallbackEligibilityInTransaction(tx, demand)) {
        throw new DemandError("DEMAND_RECOMMENDATION_FALLBACK_NOT_ELIGIBLE", "当前尚未满足往届补充推荐条件");
      }
      if (command.stage === "CURRENT") {
        const eligibility = await getCurrentMemberEligibility(tx, command.personId);
        if (!eligibility.eligible) throw new DemandError("DEMAND_RECOMMENDATION_STAGE_INVALID", "人工添加对象已不具备在任资格");
      } else {
        await this.validateAlumniCandidate(tx, command.personId, candidate.candidateKind);
      }
      const priorDecline = await tx.demandRecommendationItem.findFirst({
        where: { personId: command.personId, responseStatus: "DECLINE", run: { demandId: demand.id, stage: command.stage } },
        select: { id: true },
      });
      if (priorDecline) throw new DemandError("DEMAND_RECOMMENDATION_ALREADY_DECLINED", "该人员已明确暂不参与，不能再次定向推荐");
      const current = await tx.demandRecommendationRun.findFirst({
        where: { demandId: demand.id, stage: command.stage, currentKey: 1 },
        include: { items: { orderBy: { rank: "asc" } } },
      });
      const currentItems = current?.items ?? [];
      const retainableItems = currentItems.filter(({ responseStatus }) => responseStatus !== "DECLINE");
      if (retainableItems.length >= 3 && !command.replaceItemId) {
        throw new DemandError("DEMAND_RECOMMENDATION_MANUAL_REPLACE_REQUIRED", "当前已有 3 名推荐人，必须明确选择要替换的推荐项");
      }
      if (command.replaceItemId && !currentItems.some(({ id }) => id === command.replaceItemId)) {
        throw new DemandError("DEMAND_RECOMMENDATION_ITEM_NOT_FOUND", "要替换的推荐项不属于当前推荐结果");
      }
      const retained = retainableItems.filter(({ id }) => id !== command.replaceItemId);
      if (retained.some(({ personId }) => personId === command.personId)) {
        throw new DemandError("DEMAND_RECOMMENDATION_STAGE_INVALID", "该人员已在当前推荐结果中");
      }
      if (retained.length >= 3) throw new DemandError("DEMAND_RECOMMENDATION_MANUAL_REPLACE_REQUIRED", "当前推荐结果已满 3 人");
      const now = new Date();
      const run = await tx.demandRecommendationRun.create({ data: {
        demandId: demand.id,
        stage: command.stage,
        status: "SUCCEEDED",
        triggerType: "ADMIN",
        rulesVersion: DEMAND_MATCH_RULES_VERSION,
        provider: "manual",
        candidateCount: retained.length + 1,
        currentKey: null,
        startedAt: now,
        finishedAt: now,
        durationMs: 0,
        createdByPersonId: input.actor.personId,
      } });
      const ordered = [...retained.map((item) => ({
        personId: item.personId,
        candidateKind: item.candidateKind,
        source: item.source,
        reason: item.reason,
        evidenceSnapshotJson: item.evidenceSnapshotJson as Prisma.InputJsonValue,
        responseStatus: item.responseStatus,
        respondedAt: item.respondedAt,
        respondedByPersonId: item.respondedByPersonId,
        responseNote: item.responseNote,
      })), {
        personId: candidate.candidateId,
        candidateKind: candidate.candidateKind,
        source: "MANUAL" as DemandRecommendationSource,
        reason: command.reason,
        evidenceSnapshotJson: evidenceSnapshot({ evidence: candidate.evidence, rulesVersion: DEMAND_MATCH_RULES_VERSION, promptVersion: null, provider: "manual", model: null, snapshotAt: now }),
        responseStatus: null,
        respondedAt: null,
        respondedByPersonId: null,
        responseNote: null,
      }];
      for (const [index, item] of ordered.entries()) await tx.demandRecommendationItem.create({ data: { runId: run.id, rank: index + 1, ...item } });
      await tx.demandRecommendationRun.updateMany({
        where: { demandId: demand.id, stage: command.stage, currentKey: 1, id: { not: run.id } },
        data: { currentKey: null },
      });
      await tx.demandRecommendationRun.update({ where: { id: run.id }, data: { currentKey: 1 } });
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: command.replaceItemId ? "DEMAND_RECOMMENDATION_MANUAL_REPLACED" : "DEMAND_RECOMMENDATION_MANUAL_ADDED",
        entityType: "DEMAND",
        entityId: demand.id,
        after: { runId: run.id, stage: run.stage, personId: command.personId, replaceItemId: command.replaceItemId },
        reason: command.reason,
        context: input.context,
      });
      return { runId: run.id, stage: run.stage, itemCount: ordered.length };
    });
  }

  private async validateTownshipHandler(tx: DemandRecommendationTransaction, personId: string, areaId: string, now = new Date()) {
    if (!await this.repository.lockPerson(tx, personId)) throw new DemandError("DEMAND_TOWNSHIP_HANDLER_INVALID", "镇区经办人不存在");
    await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM accounts WHERE person_id = ${personId} FOR UPDATE`;
    const person = await tx.person.findUnique({
      where: { id: personId },
      select: {
        id: true,
        name: true,
        personStatus: true,
        account: { select: { status: true, forcePasswordChange: true, confidentialityConfirmedAt: true } },
        appointments: {
          where: { effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }] },
          select: {
            organization: {
              select: {
                id: true,
                type: true,
                status: true,
                areaMappings: {
                  where: { areaId, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }], area: { status: "ACTIVE" } },
                  select: { id: true },
                },
              },
            },
          },
        },
      },
    });
    const appointment = person?.appointments.find(({ organization }) => organization.type === "TOWNSHIP_ORG" && organization.status === "ACTIVE" && organization.areaMappings.length > 0);
    if (!person || person.personStatus !== "ACTIVE" || !accountIsUsable(person.account) || !appointment) {
      throw new DemandError("DEMAND_TOWNSHIP_HANDLER_INVALID", "所选人员不是该负责区域当前有效的镇区工作人员");
    }
    return { personId: person.id, personName: person.name, organizationId: appointment.organization.id };
  }

  private async listTownshipHandlerOptions(areaId: string) {
    const now = new Date();
    const people = await this.repository.transaction((tx) => tx.person.findMany({
      where: {
        personStatus: "ACTIVE",
        account: { is: { status: "NORMAL", forcePasswordChange: false, confidentialityConfirmedAt: { not: null } } },
        appointments: { some: {
          effectiveAt: { lte: now },
          OR: [{ expiredAt: null }, { expiredAt: { gt: now } }],
          organization: {
            type: "TOWNSHIP_ORG",
            status: "ACTIVE",
            areaMappings: { some: { areaId, effectiveAt: { lte: now }, OR: [{ expiredAt: null }, { expiredAt: { gt: now } }], area: { status: "ACTIVE" } } },
          },
        } },
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true, name: true },
    }));
    return people;
  }

  async activateAlumniHelp(input: ServiceInput & { demandId: string; body: unknown }) {
    const command = activateDemandAlumniHelpSchema.parse(input.body);
    await this.requireManage(input);
    const located = await this.repository.transaction((tx) => tx.demandRecommendationItem.findUnique({
      where: { id: command.recommendationItemId },
      select: { run: { select: { demandId: true } } },
    }));
    if (!located || located.run.demandId !== input.demandId) throw new DemandError("DEMAND_ALUMNI_HELP_INVALID", "往届推荐项不存在");
    return this.repository.transaction(async (tx) => {
      if (!await this.repository.lockDemand(tx, input.demandId)) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
      if (!await this.repository.lockItem(tx, command.recommendationItemId)) throw new DemandError("DEMAND_ALUMNI_HELP_INVALID", "往届推荐项不存在");
      const demand = await tx.demand.findUniqueOrThrow({ where: { id: input.demandId } });
      const item = await tx.demandRecommendationItem.findUniqueOrThrow({ where: { id: command.recommendationItemId }, include: { run: true } });
      if (item.run.demandId !== demand.id || item.run.stage !== "ALUMNI" || item.run.currentKey !== 1 || !item.candidateKind.startsWith("ALUMNI_") || item.responseStatus !== "WILLING") {
        throw new DemandError("DEMAND_ALUMNI_HELP_INVALID", "只能激活当前往届推荐中已明确愿意协助的人员");
      }
      if (demand.currentOwnerPersonId !== null || !["PENDING_CLAIM", "IN_PROGRESS"].includes(demand.status)) {
        throw new DemandError("DEMAND_ALUMNI_HELP_INVALID", "需求已有在任主责或当前状态不允许激活往届协助");
      }
      const existingHandler = await tx.demandTownshipHandler.findFirst({ where: { demandId: demand.id, activeKey: 1, expiredAt: null } });
      if (demand.status === "PENDING_CLAIM" && !await this.fallbackEligibilityInTransaction(tx, demand)) {
        throw new DemandError("DEMAND_RECOMMENDATION_FALLBACK_NOT_ELIGIBLE", "当前尚未满足往届补充路径条件");
      }
      if (demand.status === "IN_PROGRESS" && !existingHandler) throw new DemandError("DEMAND_ALUMNI_HELP_INVALID", "往届责任关系不完整，已拒绝追加协助人");
      if (existingHandler && existingHandler.personId !== command.townshipHandlerPersonId) {
        throw new DemandError("DEMAND_TOWNSHIP_HANDLER_INVALID", "后续往届协助人必须沿用当前镇区经办人");
      }
      const existingHelper = await tx.demandAlumniHelper.findFirst({ where: { sourceRecommendationItemId: item.id, status: "ACTIVE", activeKey: 1 } });
      if (existingHelper) return { helperId: existingHelper.id, demandId: demand.id, status: demand.status, currentOwnerPersonId: demand.currentOwnerPersonId };
      const handler = await this.validateTownshipHandler(tx, command.townshipHandlerPersonId, demand.responsibleAreaId);
      const now = new Date();
      const currentHandler = existingHandler ?? await tx.demandTownshipHandler.create({ data: {
        demandId: demand.id,
        personId: handler.personId,
        organizationId: handler.organizationId,
        effectiveAt: now,
        activeKey: 1,
        assignedByPersonId: input.actor.personId,
        reason: command.reason,
      } });
      const helper = await tx.demandAlumniHelper.create({ data: {
        demandId: demand.id,
        personId: item.personId,
        helperKind: item.candidateKind === "ALUMNI_PLATFORM" ? "PLATFORM" : "HISTORICAL",
        sourceRecommendationItemId: item.id,
        effectiveAt: now,
        status: "ACTIVE",
        activeKey: 1,
        createdByPersonId: input.actor.personId,
        reason: command.reason,
      } });
      const firstActivation = demand.status === "PENDING_CLAIM";
      const updated = firstActivation ? await tx.demand.update({ where: { id: demand.id }, data: { status: "IN_PROGRESS", currentOwnerPersonId: null } }) : demand;
      await writeDemandAudit(tx, {
        actor: input.actor,
        actionCode: "DEMAND_ALUMNI_HELP_ACTIVATED",
        entityType: "DEMAND",
        entityId: demand.id,
        before: { status: demand.status, currentOwnerPersonId: demand.currentOwnerPersonId },
        after: { status: updated.status, currentOwnerPersonId: updated.currentOwnerPersonId, helperId: helper.id, townshipHandlerId: currentHandler.id },
        reason: command.reason,
        context: input.context,
      });
      if (firstActivation) await writeDemandTransition(tx, {
        actor: input.actor,
        entityType: "DEMAND",
        entityId: demand.id,
        fromState: "PENDING_CLAIM",
        toState: "IN_PROGRESS",
        actionCode: "DEMAND_ALUMNI_HELP_ACTIVATED",
        reason: command.reason,
        metadata: { helperId: helper.id, townshipHandlerPersonId: handler.personId },
        context: input.context,
      });
      return { helperId: helper.id, townshipHandlerId: currentHandler.id, demandId: demand.id, status: updated.status, currentOwnerPersonId: updated.currentOwnerPersonId };
    });
  }

  async getCurrentDemandResponsibility(demandId: string): Promise<
    | { mode: "CURRENT_OWNER"; ownerPersonId: string }
    | { mode: "ALUMNI_TOWNSHIP"; townshipHandlerPersonId: string; alumniHelperPersonIds: string[] }
    | null
  > {
    const demand = await this.repository.transaction((tx) => tx.demand.findUnique({
      where: { id: demandId },
      select: {
        currentOwnerPersonId: true,
        ownerHistories: { where: { activeKey: 1, expiredAt: null }, select: { personId: true }, take: 2 },
        townshipHandlers: { where: { activeKey: 1, expiredAt: null }, select: { personId: true }, take: 2 },
        alumniHelpers: { where: { activeKey: 1, status: "ACTIVE", expiredAt: null }, select: { personId: true }, orderBy: { effectiveAt: "asc" } },
      },
    }));
    if (!demand) throw new DemandError("DEMAND_NOT_FOUND", "需求不存在");
    if (demand.currentOwnerPersonId) {
      if (demand.ownerHistories.length !== 1 || demand.ownerHistories[0].personId !== demand.currentOwnerPersonId || demand.townshipHandlers.length > 0) {
        throw new DemandError("DEMAND_STATE_CONFLICT", "需求责任关系不一致");
      }
      return { mode: "CURRENT_OWNER", ownerPersonId: demand.currentOwnerPersonId };
    }
    if (demand.townshipHandlers.length === 1 && demand.alumniHelpers.length > 0) {
      return { mode: "ALUMNI_TOWNSHIP", townshipHandlerPersonId: demand.townshipHandlers[0].personId, alumniHelperPersonIds: demand.alumniHelpers.map(({ personId }) => personId) };
    }
    return null;
  }
}

export { getClaimDeadline, getDemandClaimPeriodDays, isAlumniFallbackEligible };
