import type { PresenceReport, Prisma } from "@/generated/prisma/client";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import {
  writePresenceAudit,
  writePresenceTransition,
  type PresenceMutationContext,
} from "./audit";
import { PresenceError } from "./errors";
import { PresenceRepository, type PresenceTransaction } from "./repository/presence-repository";
import {
  derivePresenceStatus,
  canSelfMutatePresence,
  presenceCancelSchema,
  presenceCorrectionSchema,
  presenceCreateSchema,
  presenceHistoryQuerySchema,
  presenceUpdateSchema,
} from "./schemas";

type ServiceInput = { actor: PermissionActor; context?: PresenceMutationContext };

function normalizeOptional(value: string | null | undefined): string | null | undefined {
  return value === undefined ? undefined : value === null || value.trim() === "" ? null : value.trim();
}

function snapshot(report: Pick<PresenceReport,
  "id" | "personId" | "arrivalAt" | "expectedDepartureAt" | "origin" | "transportMode"
  | "trainFlightNo" | "note" | "canceledAt" | "cancelReason"
>): Prisma.InputJsonObject {
  return {
    id: report.id,
    personId: report.personId,
    arrivalAt: report.arrivalAt.toISOString(),
    expectedDepartureAt: report.expectedDepartureAt.toISOString(),
    origin: report.origin,
    transportMode: report.transportMode,
    trainFlightNo: report.trainFlightNo,
    note: report.note,
    canceledAt: report.canceledAt?.toISOString() ?? null,
    cancelReason: report.cancelReason,
  };
}

function assertInterval(arrivalAt: Date, expectedDepartureAt: Date) {
  if (expectedDepartureAt <= arrivalAt) {
    throw new PresenceError("PRESENCE_INTERVAL_INVALID", "预计离宝时间必须晚于到宝时间");
  }
}

export class PresenceService {
  constructor(private readonly repository = new PresenceRepository()) {}

  private async assertNoOverlap(
    tx: PresenceTransaction,
    input: { personId: string; arrivalAt: Date; expectedDepartureAt: Date; excludeId?: string },
  ) {
    const overlap = await this.repository.findOverlap(tx, input);
    if (overlap) {
      throw new PresenceError("PRESENCE_INTERVAL_OVERLAP", "该时间段与已有未取消来离宝报备重叠", {
        conflictingReportId: overlap.id,
      });
    }
  }

  async create(input: ServiceInput & { body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "presence.report.self", resource: {
      resourceType: "presence_report", requiredScope: "SELF", ownerPersonId: input.actor.personId,
    } });
    const body = presenceCreateSchema.parse(input.body);
    return this.repository.transaction(async (tx) => {
      await this.repository.lockPerson(tx, input.actor.personId);
      await this.assertNoOverlap(tx, { personId: input.actor.personId, ...body });
      const created = await tx.presenceReport.create({ data: {
        personId: input.actor.personId,
        arrivalAt: body.arrivalAt,
        expectedDepartureAt: body.expectedDepartureAt,
        origin: normalizeOptional(body.origin),
        transportMode: normalizeOptional(body.transportMode),
        trainFlightNo: normalizeOptional(body.trainFlightNo),
        note: normalizeOptional(body.note),
      } });
      await writePresenceAudit(tx, {
        ...input,
        actionCode: "PRESENCE_CREATED",
        entityId: created.id,
        after: snapshot(created),
      });
      return created;
    });
  }

  async updateMine(input: ServiceInput & { reportId: string; body: unknown; now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "presence.report.self", resource: {
      resourceType: "presence_report", requiredScope: "SELF", ownerPersonId: input.actor.personId,
    } });
    const changes = presenceUpdateSchema.parse(input.body);
    const now = input.now ?? new Date();
    return this.repository.transaction(async (tx) => {
      await this.repository.lockPerson(tx, input.actor.personId);
      const current = await this.repository.findReport(tx, input.reportId);
      if (!current || current.personId !== input.actor.personId) {
        throw new PresenceError("PRESENCE_NOT_FOUND", "来离宝报备不存在");
      }
      if (!canSelfMutatePresence(current, now)) {
        throw new PresenceError("PRESENCE_SELF_EDIT_FORBIDDEN", "已取消或已结束的历史记录只能由管理员正式纠错");
      }
      const candidate = {
        arrivalAt: changes.arrivalAt ?? current.arrivalAt,
        expectedDepartureAt: changes.expectedDepartureAt ?? current.expectedDepartureAt,
      };
      assertInterval(candidate.arrivalAt, candidate.expectedDepartureAt);
      if (candidate.expectedDepartureAt <= now) {
        throw new PresenceError("PRESENCE_SELF_EDIT_FORBIDDEN", "本人修改后的预计离宝时间必须晚于当前时间");
      }
      await this.assertNoOverlap(tx, { personId: current.personId, ...candidate, excludeId: current.id });
      const updated = await tx.presenceReport.update({ where: { id: current.id }, data: {
        ...candidate,
        origin: normalizeOptional(changes.origin),
        transportMode: normalizeOptional(changes.transportMode),
        trainFlightNo: normalizeOptional(changes.trainFlightNo),
        note: normalizeOptional(changes.note),
      } });
      await writePresenceAudit(tx, {
        ...input,
        actionCode: "PRESENCE_UPDATED",
        entityId: current.id,
        before: snapshot(current),
        after: snapshot(updated),
      });
      return updated;
    });
  }

  async cancelMine(input: ServiceInput & { reportId: string; body: unknown; now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "presence.report.self", resource: {
      resourceType: "presence_report", requiredScope: "SELF", ownerPersonId: input.actor.personId,
    } });
    const { reason } = presenceCancelSchema.parse(input.body);
    const now = input.now ?? new Date();
    return this.repository.transaction(async (tx) => {
      await this.repository.lockPerson(tx, input.actor.personId);
      const current = await this.repository.findReport(tx, input.reportId);
      if (!current || current.personId !== input.actor.personId) {
        throw new PresenceError("PRESENCE_NOT_FOUND", "来离宝报备不存在");
      }
      if (!canSelfMutatePresence(current, now)) {
        throw new PresenceError("PRESENCE_SELF_EDIT_FORBIDDEN", "只能取消本人尚未结束且未取消的记录");
      }
      const fromState = derivePresenceStatus(current, now);
      const updated = await tx.presenceReport.update({ where: { id: current.id }, data: {
        canceledAt: now,
        cancelReason: reason,
      } });
      await writePresenceAudit(tx, {
        ...input,
        actionCode: "PRESENCE_CANCELED",
        entityId: current.id,
        before: snapshot(current),
        after: snapshot(updated),
        reason,
      });
      await writePresenceTransition(tx, {
        ...input,
        entityId: current.id,
        fromState,
        toState: "CANCELED",
        actionCode: "PRESENCE_CANCELED",
        reason,
      });
      return updated;
    });
  }

  async listMine(input: ServiceInput & { now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "presence.history.self_view", resource: {
      resourceType: "presence_report", requiredScope: "SELF", ownerPersonId: input.actor.personId,
    } });
    const now = input.now ?? new Date();
    const items = await this.repository.listMine(input.actor.personId);
    return items.map((item) => ({ ...item, status: derivePresenceStatus(item, now) }));
  }

  async getMine(input: ServiceInput & { reportId: string; now?: Date }) {
    const items = await this.listMine(input);
    const report = items.find(({ id }) => id === input.reportId);
    if (!report) throw new PresenceError("PRESENCE_NOT_FOUND", "来离宝报备不存在");
    return report;
  }

  async current(input: ServiceInput & { now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "presence.current.view" });
    const now = input.now ?? new Date();
    const { rows, currentActiveBatchCount } = await this.repository.listCurrent(now);
    const unique = new Map<string, (typeof rows)[number]>();
    const duplicatePersonIds = new Set<string>();
    for (const row of rows) {
      if (unique.has(row.personId)) duplicatePersonIds.add(row.personId);
      else unique.set(row.personId, row);
    }
    if (duplicatePersonIds.size > 0) {
      console.warn("Presence current query found duplicate active intervals", {
        duplicatePersonCount: duplicatePersonIds.size,
        personIds: [...duplicatePersonIds],
      });
    }
    const currentBatchConfigurationInvalid = currentActiveBatchCount !== 1;
    if (currentBatchConfigurationInvalid) {
      console.warn("Presence current classification found invalid current ACTIVE batch count", {
        currentActiveBatchCount,
      });
    }
    const items = [...unique.values()].map((row) => ({
      person: {
        id: row.person.id,
        name: row.person.name,
        memberType: row.person.batchMemberships.length > 0 && row.person.roleAssignments.length > 0
          ? "CURRENT" as const
          : "ALUMNI" as const,
      },
      arrivalAt: row.arrivalAt,
      expectedDepartureAt: row.expectedDepartureAt,
    }));
    return {
      total: items.length,
      currentCount: items.filter(({ person }) => person.memberType === "CURRENT").length,
      alumniCount: items.filter(({ person }) => person.memberType === "ALUMNI").length,
      items,
      ...(input.actor.hasGlobalOperational && (duplicatePersonIds.size > 0 || currentBatchConfigurationInvalid)
        ? { diagnostics: {
            ...(duplicatePersonIds.size > 0 ? { duplicatePersonCount: duplicatePersonIds.size } : {}),
            ...(currentBatchConfigurationInvalid ? {
              currentActiveBatchCount,
              configurationIssues: ["CURRENT_ACTIVE_BATCH_COUNT_INVALID" as const],
            } : {}),
          } }
        : {}),
    };
  }

  currentSummary(input: ServiceInput & { now?: Date }) {
    return this.current(input);
  }

  async adminHistory(input: ServiceInput & { query: unknown; now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "presence.history.admin_view", resource: {
      resourceType: "presence_report", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    const query = presenceHistoryQuerySchema.parse(input.query);
    const now = input.now ?? new Date();
    const result = await this.repository.listAdminHistory({ ...query, now });
    return {
      ...result,
      items: result.items.map((item) => ({ ...item, status: derivePresenceStatus(item, now) })),
    };
  }

  async correct(input: ServiceInput & { reportId: string; body: unknown; now?: Date }) {
    await authorizeActor({ actor: input.actor, action: "presence.correct.admin", resource: {
      resourceType: "presence_report", requiredScope: "GLOBAL_OPERATIONAL",
    } });
    const { changes, reason } = presenceCorrectionSchema.parse(input.body);
    const now = input.now ?? new Date();
    const initial = await this.repository.transaction((tx) => this.repository.findReport(tx, input.reportId));
    if (!initial) throw new PresenceError("PRESENCE_NOT_FOUND", "来离宝报备不存在");
    return this.repository.transaction(async (tx) => {
      await this.repository.lockPerson(tx, initial.personId);
      const current = await this.repository.findReport(tx, input.reportId);
      if (!current) throw new PresenceError("PRESENCE_NOT_FOUND", "来离宝报备不存在");
      const candidate = {
        arrivalAt: changes.arrivalAt ?? current.arrivalAt,
        expectedDepartureAt: changes.expectedDepartureAt ?? current.expectedDepartureAt,
        canceledAt: changes.canceledAt === undefined ? current.canceledAt : changes.canceledAt,
        cancelReason: changes.canceledAt === null
          ? null
          : normalizeOptional(changes.cancelReason) ?? current.cancelReason,
      };
      assertInterval(candidate.arrivalAt, candidate.expectedDepartureAt);
      if (candidate.canceledAt && !candidate.cancelReason) {
        throw new PresenceError("PRESENCE_CANCEL_REASON_REQUIRED", "取消记录必须填写取消原因");
      }
      if (!candidate.canceledAt && candidate.cancelReason) {
        throw new PresenceError("PRESENCE_CANCEL_REASON_REQUIRED", "未取消记录不能保留取消原因");
      }
      if (!candidate.canceledAt) {
        await this.assertNoOverlap(tx, {
          personId: current.personId,
          arrivalAt: candidate.arrivalAt,
          expectedDepartureAt: candidate.expectedDepartureAt,
          excludeId: current.id,
        });
      }
      const beforeState = derivePresenceStatus(current, now);
      const updated = await tx.presenceReport.update({ where: { id: current.id }, data: {
        arrivalAt: candidate.arrivalAt,
        expectedDepartureAt: candidate.expectedDepartureAt,
        origin: normalizeOptional(changes.origin),
        transportMode: normalizeOptional(changes.transportMode),
        trainFlightNo: normalizeOptional(changes.trainFlightNo),
        note: normalizeOptional(changes.note),
        canceledAt: candidate.canceledAt,
        cancelReason: candidate.cancelReason,
      } });
      const afterState = derivePresenceStatus(updated, now);
      await writePresenceAudit(tx, {
        ...input,
        actionCode: "PRESENCE_ADMIN_CORRECTED",
        entityId: current.id,
        before: snapshot(current),
        after: snapshot(updated),
        reason,
      });
      if (beforeState !== afterState && (beforeState === "CANCELED" || afterState === "CANCELED")) {
        await writePresenceTransition(tx, {
          ...input,
          entityId: current.id,
          fromState: beforeState,
          toState: afterState,
          actionCode: "PRESENCE_ADMIN_CORRECTED",
          reason,
        });
      }
      return updated;
    });
  }
}
