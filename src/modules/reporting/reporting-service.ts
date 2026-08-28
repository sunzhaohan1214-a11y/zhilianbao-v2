import { createHash, randomUUID } from "node:crypto";
import { Prisma as PrismaRuntime } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import type { AuthRequestContext } from "@/modules/identity/request-context";
import { resolvePermissionActor } from "@/modules/permissions/actor-resolver";
import type { PermissionActor } from "@/modules/permissions/types";
import { JobRepository } from "@/modules/jobs/job-repository";
import { getAttachmentRuntime } from "@/modules/attachment/runtime";
import { buildMonthlyWorkbook, type DataQualityWarning, type MonthlyReportData } from "./monthly-workbook";
import { getDemandProgressFreshnessAt, outcomePlanAt, ownerAt, resolveDemandBatchAt, statusAt } from "./demand-as-of";
import { ReportingError } from "./errors";
import { inPeriod, resolveMonthlyPeriod, shanghaiDateKey } from "./monthly-period";
import { canDownloadMonthlyReport, resolveMonthlyReportScope, resolveSelectedAreaIds, scopeStillAllowed, type MonthlyReportScope } from "./reporting-scope";
import { monthlyReportExportSchema, monthlyReportQuerySchema } from "./schemas";

const STOCK_STATUSES = ["PENDING_REVIEW", "RETURNED", "PENDING_CLAIM", "IN_PROGRESS", "PENDING_CLOSE_REVIEW"] as const;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const REPORT_PAGE_SIZE = 500;

type Query = { month: string; batchId?: string; areaId?: string };
type WarningCode = "UNRESOLVED_BATCH_AT_ASOF" | "ENTERPRISE_STATUS_ASOF_LIMITED" | "ENTERPRISE_AREA_ASOF_MISSING" | "TALENT_AREA_ATTRIBUTION_MISSING" | "PRESENCE_AREA_ATTRIBUTION_MISSING" | "BATCH_AT_ASOF_INVALID";

function date(value: Date | null | undefined): string | null { return value ? shanghaiDateKey(value) : null; }
function dateTime(value: Date | null | undefined): string | null { return value ? value.toISOString() : null; }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function hashBytes(value: Buffer): string { return createHash("sha256").update(value).digest("hex"); }
function payload(query: Query): string { return JSON.stringify({ month: query.month, batchId: query.batchId ?? null, areaId: query.areaId ?? null }); }
function selected(where: string[] | null, areaId: string): boolean { return where === null || where.includes(areaId); }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }

async function loadReportPages<T extends { id: string }>(load: (cursor?: string) => Promise<T[]>): Promise<T[]> {
  const result: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await load(cursor);
    result.push(...page);
    cursor = page.length === REPORT_PAGE_SIZE ? page.at(-1)?.id : undefined;
  } while (cursor);
  return result;
}

class Warnings {
  private readonly counts = new Map<WarningCode, number>();
  add(code: WarningCode, count = 1) { this.counts.set(code, (this.counts.get(code) ?? 0) + count); }
  list(): DataQualityWarning[] {
    const messages: Record<WarningCode, string> = {
      UNRESOLVED_BATCH_AT_ASOF: "缺少可靠历史批次证据，已从批次筛选指标排除。",
      ENTERPRISE_STATUS_ASOF_LIMITED: "缺少可用的企业历史版本，未使用今天状态冒充历史状态。",
      ENTERPRISE_AREA_ASOF_MISSING: "企业历史版本缺少镇区归属，已从区域指标排除。",
      TALENT_AREA_ATTRIBUTION_MISSING: "人才新增缺少可靠镇区轮次归属，已从区域指标排除。",
      PRESENCE_AREA_ATTRIBUTION_MISSING: "来离宝记录缺少唯一有效任职/会员区域归属，已从区域指标排除。",
      BATCH_AT_ASOF_INVALID: "统计时点没有唯一有效批次；未猜测当前批次。",
    };
    return [...this.counts].filter(([, count]) => count > 0).map(([code, count]) => ({ code, count, message: messages[code] }));
  }
}

function effective(start: Date, end: Date | null, at: Date): boolean { return start <= at && (end === null || end > at); }

function personAreasAt(person: {
  appointments: Array<{ effectiveAt: Date; expiredAt: Date | null; organization: { areaMappings: Array<{ areaId: string; effectiveAt: Date; expiredAt: Date | null }>; departmentAreaRelations: Array<{ areaId: string; effectiveAt: Date; expiredAt: Date | null }> } }>;
  batchMemberships: Array<{ status: string; startDate: Date; endDate: Date | null; postOrganization: { areaMappings: Array<{ areaId: string; effectiveAt: Date; expiredAt: Date | null }>; departmentAreaRelations: Array<{ areaId: string; effectiveAt: Date; expiredAt: Date | null }> } | null }>;
}, at: Date): string[] {
  const areas = new Set<string>();
  for (const appointment of person.appointments) if (effective(appointment.effectiveAt, appointment.expiredAt, at)) {
    [...appointment.organization.areaMappings, ...appointment.organization.departmentAreaRelations].filter((item) => effective(item.effectiveAt, item.expiredAt, at)).forEach((item) => areas.add(item.areaId));
  }
  for (const membership of person.batchMemberships) if (effective(membership.startDate, membership.endDate, at)) {
    const mappings = membership.postOrganization ? [...membership.postOrganization.areaMappings, ...membership.postOrganization.departmentAreaRelations] : [];
    mappings.filter((item) => effective(item.effectiveAt, item.expiredAt, at)).forEach((item) => areas.add(item.areaId));
  }
  return [...areas];
}

export class ReportingService {
  constructor(private readonly prisma = getPrismaClient(), private readonly jobs = new JobRepository()) {}

  async options(actor: PermissionActor) {
    const scope = resolveMonthlyReportScope(actor);
    const [areas, batches] = await Promise.all([
      this.prisma.administrativeArea.findMany({ where: { status: "ACTIVE", ...(scope.countyWide ? {} : { id: { in: scope.areaIds } }) }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true } }),
      this.prisma.batch.findMany({ orderBy: [{ startDate: "desc" }, { id: "asc" }], select: { id: true, name: true, startDate: true, endDate: true } }),
    ]);
    return { scope, areas, batches };
  }

  async previewMonthlyReport(input: { actor: PermissionActor; query: unknown; now?: Date }) {
    const query = monthlyReportQuerySchema.parse(input.query);
    const data = await this.collect(input.actor, query, input.now);
    return { ...data, rows: { demands: data.rows.demands.slice(0, 10), trips: data.rows.trips.slice(0, 10), talents: data.rows.talents.slice(0, 10), outcomes: data.rows.outcomes.slice(0, 10) }, rowCounts: {
      demands: data.rows.demands.length, trips: data.rows.trips.length, talents: data.rows.talents.length, outcomes: data.rows.outcomes.length,
    } };
  }

  async createMonthlyExport(input: { actor: PermissionActor; body: unknown; idempotencyKey?: string; context?: AuthRequestContext }) {
    if (!canDownloadMonthlyReport(input.actor)) throw new ReportingError("REPORT_FORBIDDEN", "当前账号不能下载月度工作台账");
    const key = input.idempotencyKey?.trim();
    if (!key || key.length > 191) throw new ReportingError("REPORT_IDEMPOTENCY_REQUIRED", "创建导出任务必须提供 Idempotency-Key");
    const query = monthlyReportExportSchema.parse(input.body);
    resolveMonthlyPeriod(query.month);
    const scope = resolveMonthlyReportScope(input.actor);
    const selectedAreaIds = resolveSelectedAreaIds(scope, query.areaId);
    if (query.batchId && await this.prisma.batch.count({ where: { id: query.batchId } }) !== 1) throw new ReportingError("REPORT_BATCH_INVALID", "所选批次不存在");
    if (query.areaId && await this.prisma.administrativeArea.count({ where: { id: query.areaId, status: "ACTIVE" } }) !== 1) throw new ReportingError("REPORT_AREA_INVALID", "所选区域不存在或已停用");
    const keyHash = hash(key); const payloadHash = hash(payload(query));
    const existing = await this.prisma.monthlyReportExportTask.findUnique({ where: { createdByPersonId_idempotencyKeyHash: { createdByPersonId: input.actor.personId, idempotencyKeyHash: keyHash } } });
    if (existing) {
      if (existing.payloadHash !== payloadHash) throw new ReportingError("REPORT_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同月报筛选");
      return this.presentTask(existing);
    }
    try {
      const task = await this.prisma.$transaction(async (tx) => {
        const created = await tx.monthlyReportExportTask.create({ data: {
          month: query.month, batchId: query.batchId, querySnapshot: { month: query.month, batchId: query.batchId ?? null, areaId: query.areaId ?? null },
          scopeSnapshot: { countyWide: scope.countyWide, areaIds: scope.areaIds, selectedAreaIds, effectiveRoles: input.actor.effectiveRoles, capabilities: [...input.actor.capabilities].sort() }, createdByPersonId: input.actor.personId, idempotencyKeyHash: keyHash, payloadHash,
        } });
        await this.jobs.enqueue({ jobType: "MONTHLY_REPORT_EXPORT", payload: { exportTaskId: created.id }, idempotencyKey: `monthly-report-export:${created.id}`, maxRetries: 3 }, tx);
        await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "MONTHLY_REPORT_EXPORT_CREATED", entityType: "MONTHLY_REPORT_EXPORT_TASK", entityId: created.id,
          afterJson: { month: query.month, batchId: query.batchId ?? null, areaId: query.areaId ?? null, scopeSnapshot: { countyWide: scope.countyWide, areaIds: scope.areaIds } }, requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } });
        return created;
      });
      return this.presentTask(task);
    } catch (error) {
      const replay = await this.prisma.monthlyReportExportTask.findUnique({ where: { createdByPersonId_idempotencyKeyHash: { createdByPersonId: input.actor.personId, idempotencyKeyHash: keyHash } } });
      if (replay) {
        if (replay.payloadHash !== payloadHash) throw new ReportingError("REPORT_IDEMPOTENCY_CONFLICT", "同一 Idempotency-Key 不能用于不同月报筛选");
        return this.presentTask(replay);
      }
      throw error;
    }
  }

  async exportDetail(input: { actor: PermissionActor; taskId: string }) {
    const task = await this.prisma.monthlyReportExportTask.findFirst({ where: { id: input.taskId, ...(input.actor.hasSystem ? {} : { createdByPersonId: input.actor.personId }) } });
    if (!task) throw new ReportingError("REPORT_NOT_FOUND", "导出任务不存在或无权查看");
    if (!input.actor.hasSystem && (!canDownloadMonthlyReport(input.actor) || !scopeStillAllowed(this.snapshotScope(task.scopeSnapshot), resolveMonthlyReportScope(input.actor)))) {
      throw new ReportingError("REPORT_NOT_FOUND", "导出任务不存在或无权查看");
    }
    return this.presentTask(task);
  }

  async processExport(exportTaskId: string) {
    const task = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM monthly_report_export_tasks WHERE id = ${exportTaskId} FOR UPDATE`;
      const current = await tx.monthlyReportExportTask.findUnique({ where: { id: exportTaskId } });
      if (!current || current.status === "SUCCEEDED") return current;
      return tx.monthlyReportExportTask.update({ where: { id: current.id }, data: { status: "RUNNING", startedAt: current.startedAt ?? new Date(), finishedAt: null, errorCode: null } });
    });
    if (!task || task.status === "SUCCEEDED") return;
    try {
      const actor = await this.currentActor(task.createdByPersonId);
      if (!canDownloadMonthlyReport(actor)) throw new ReportingError("REPORT_PERMISSION_REVOKED", "导出创建人已失去月报下载权限");
      const currentScope = resolveMonthlyReportScope(actor);
      if (!scopeStillAllowed(this.snapshotScope(task.scopeSnapshot), currentScope)) throw new ReportingError("REPORT_PERMISSION_REVOKED", "导出创建人的当前数据范围已缩小");
      const raw = asRecord(task.querySnapshot); if (!raw) throw new Error("REPORT_QUERY_SNAPSHOT_INVALID");
      const query = monthlyReportExportSchema.parse({ month: raw.month, ...(raw.batchId ? { batchId: raw.batchId } : {}), ...(raw.areaId ? { areaId: raw.areaId } : {}) });
      const data = await this.collect(actor, query);
      const body = await buildMonthlyWorkbook(data);
      const storage = getAttachmentRuntime().storage;
      const objectKey = `monthly-reports/${query.month.slice(0, 4)}/${query.month.slice(5, 7)}/${task.id}/${randomUUID()}.xlsx`;
      await storage.writeObject(objectKey, body, XLSX_MIME);
      let linked = false;
      try {
        linked = await this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM monthly_report_export_tasks WHERE id = ${task.id} FOR UPDATE`;
          const current = await tx.monthlyReportExportTask.findUnique({ where: { id: task.id } });
          if (current?.status === "SUCCEEDED") return false;
          if (!current || current.status !== "RUNNING") throw new ReportingError("REPORT_EXPORT_STATE_CONFLICT", "导出任务状态已变化");
          const attachment = await tx.attachment.create({ data: { originalFilename: `monthly-report-${query.month}.xlsx`, extension: "xlsx", declaredMimeType: XLSX_MIME, detectedMimeType: XLSX_MIME,
            detectedFileType: "xlsx", expectedSizeBytes: BigInt(body.length), actualSizeBytes: BigInt(body.length), sha256: hashBytes(body), bucket: storage.bucket, region: storage.region,
            objectKey, uploadStatus: "UPLOADED", scanStatus: "PASSED", isTemporary: false, permissionLevel: "SENSITIVE_PARENT", uploadedByPersonId: task.createdByPersonId } });
          await tx.attachmentLink.create({ data: { attachmentId: attachment.id, entityType: "MONTHLY_REPORT_EXPORT_TASK", entityId: task.id, relationType: "OUTPUT", createdByPersonId: task.createdByPersonId } });
          await tx.monthlyReportExportTask.update({ where: { id: task.id }, data: { status: "SUCCEEDED", outputAttachmentId: attachment.id, finishedAt: new Date(), errorCode: null } });
          return true;
        });
      } catch (error) {
        await storage.deleteObject(objectKey).catch(() => undefined);
        throw error;
      }
      if (!linked) await storage.deleteObject(objectKey).catch(() => undefined);
    } catch (error) {
      const code = error instanceof ReportingError ? error.code : error instanceof Error ? error.message.slice(0, 100) : "REPORT_EXPORT_FAILED";
      await this.prisma.monthlyReportExportTask.updateMany({ where: { id: task.id, status: "RUNNING" }, data: { status: "FAILED", finishedAt: new Date(), errorCode: code } });
      throw error;
    }
  }

  private snapshotScope(value: unknown): MonthlyReportScope {
    const snapshot = asRecord(value);
    if (!snapshot || typeof snapshot.countyWide !== "boolean" || !Array.isArray(snapshot.areaIds) || !snapshot.areaIds.every((item) => typeof item === "string")) throw new Error("REPORT_SCOPE_SNAPSHOT_INVALID");
    return snapshot.countyWide ? { countyWide: true, areaIds: [] } : { countyWide: false, areaIds: snapshot.areaIds as string[] };
  }

  private presentTask(task: { id: string; month: string; batchId: string | null; status: string; outputAttachmentId: string | null; errorCode: string | null; createdAt: Date; startedAt: Date | null; finishedAt: Date | null }) {
    return { id: task.id, month: task.month, batchId: task.batchId, status: task.status, outputAttachmentId: task.outputAttachmentId, errorCode: task.errorCode,
      createdAt: task.createdAt.toISOString(), startedAt: task.startedAt?.toISOString() ?? null, finishedAt: task.finishedAt?.toISOString() ?? null };
  }

  private async currentActor(personId: string): Promise<PermissionActor> {
    const account = await this.prisma.account.findUnique({ where: { personId }, include: { person: true } });
    if (!account) throw new ReportingError("REPORT_PERMISSION_REVOKED", "导出创建人账号不存在");
    try {
      return await resolvePermissionActor({ sessionId: "monthly-report-worker", accountId: account.id, personId, name: account.person.name, phone: account.phone, accountStatus: account.status,
        forcePasswordChange: account.forcePasswordChange, confidentialityConfirmedAt: account.confidentialityConfirmedAt, permissionVersion: account.permissionVersion, deviceId: "worker", roles: [] });
    } catch {
      throw new ReportingError("REPORT_PERMISSION_REVOKED", "导出创建人的账号或任职权限已失效");
    }
  }

  private async collect(actor: PermissionActor, query: Query, now?: Date): Promise<MonthlyReportData> {
    const period = resolveMonthlyPeriod(query.month, now);
    const scope = resolveMonthlyReportScope(actor);
    const areaIds = resolveSelectedAreaIds(scope, query.areaId);
    const warnings = new Warnings();
    const [areaRows, batch] = await Promise.all([
      this.prisma.administrativeArea.findMany({ where: areaIds ? { id: { in: areaIds } } : {}, select: { id: true, name: true } }),
      query.batchId ? this.prisma.batch.findUnique({ where: { id: query.batchId }, select: { id: true, name: true } }) : Promise.resolve(null),
    ]);
    if (query.batchId && !batch) throw new ReportingError("REPORT_BATCH_INVALID", "所选批次不存在");
    const whereArea = areaIds ? { responsibleAreaId: { in: areaIds } } : {};

    const demands = await loadReportPages((cursor) => this.prisma.demand.findMany({ where: { ...whereArea, firstPublishedAt: { not: null, lte: period.asOf } }, orderBy: { id: "asc" }, take: REPORT_PAGE_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: {
      enterprise: { select: { name: true } }, responsibleArea: { select: { name: true } }, creationBatch: { select: { name: true } }, completionBatch: { select: { name: true } },
      ownerHistories: { include: { person: { select: { name: true } } }, orderBy: [{ effectiveAt: "asc" }, { id: "asc" }] },
      townshipHandlers: { include: { person: { select: { name: true } } }, orderBy: [{ effectiveAt: "asc" }, { id: "asc" }] }, progresses: { select: { createdAt: true } }, closeReviews: { select: { decision: true, reviewedAt: true } },
      outcomePlan: { include: { rounds: { where: { reviewStatus: "APPROVED" }, select: { reviewedAt: true, nextTrackingDate: true, endTracking: true, roundNo: true } } } },
    } }));
    const demandIds = demands.map(({ id }) => id);
    const [transitions, transferAudits] = demandIds.length ? await Promise.all([
      this.prisma.stateTransitionHistory.findMany({ where: { entityType: "DEMAND", entityId: { in: demandIds }, createdAt: { lte: period.asOf } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      this.prisma.auditLog.findMany({ where: { entityType: "DEMAND", entityId: { in: demandIds }, actionCode: "DEMAND_OWNER_TRANSFERRED", createdAt: { lte: period.asOf } }, select: { entityId: true, afterJson: true, createdAt: true } }),
    ]) : [[], []];
    const byDemand = new Map<string, typeof transitions>(); transitions.forEach((item) => { const rows = byDemand.get(item.entityId) ?? []; rows.push(item); byDemand.set(item.entityId, rows); });
    const auditsByDemand = new Map<string, typeof transferAudits>(); transferAudits.forEach((item) => { const rows = auditsByDemand.get(item.entityId ?? "") ?? []; rows.push(item); auditsByDemand.set(item.entityId ?? "", rows); });
    const stock = Object.fromEntries(STOCK_STATUSES.map((status) => [status, 0])) as Record<string, number>;
    let demandAdded = 0; let demandCompleted = 0; let staleCount = 0; let outcomeDueCount = 0;
    const demandRows: MonthlyReportData["rows"]["demands"] = [];
    for (const demand of demands) {
      const status = statusAt(byDemand.get(demand.id) ?? [], period.asOf);
      const batchAt = resolveDemandBatchAt({ creationBatchId: demand.creationBatchId, ownerHistories: demand.ownerHistories.map((item) => ({ ...item, personName: item.person.name })),
        transferFacts: (auditsByDemand.get(demand.id) ?? []).map((item) => ({ occurredAt: item.createdAt, metadataJson: item.afterJson })), asOf: period.asOf });
      const matchesStockBatch = !query.batchId || batchAt === query.batchId;
      if (query.batchId && !batchAt) warnings.add("UNRESOLVED_BATCH_AT_ASOF");
      const added = inPeriod(demand.firstPublishedAt, period) && (!query.batchId || demand.creationBatchId === query.batchId);
      const closeApprovedAt = demand.closeReviews.filter((review) => review.decision === "APPROVE" && review.reviewedAt <= period.asOf).sort((a, b) => a.reviewedAt.getTime() - b.reviewedAt.getTime()).at(-1)?.reviewedAt ?? null;
      const completed = inPeriod(closeApprovedAt, period) && (!query.batchId || demand.completionBatchId === query.batchId);
      if (added) demandAdded += 1; if (completed) demandCompleted += 1;
      if (status && STOCK_STATUSES.includes(status as typeof STOCK_STATUSES[number]) && matchesStockBatch) stock[status] += 1;
      const owner = ownerAt(demand.ownerHistories.map((item) => ({ ...item, personName: item.person.name })), period.asOf);
      const activeHandlers = demand.townshipHandlers.filter((item) => effective(item.effectiveAt, item.expiredAt, period.asOf));
      const handler = activeHandlers.length === 1 ? activeHandlers[0] : null;
      const freshness = getDemandProgressFreshnessAt({ status, progresses: demand.progresses, responsibilityBaselines: [owner?.effectiveAt, handler?.effectiveAt].filter((item): item is Date => Boolean(item)), asOf: period.asOf });
      const plan = demand.outcomePlan ? outcomePlanAt({ ...demand.outcomePlan, approvedRounds: demand.outcomePlan.rounds, asOf: period.asOf }) : { status: "NOT_TRACKED" as const, nextDueDate: null };
      const due = (plan.status === "PENDING" || plan.status === "IN_PROGRESS") && Boolean(plan.nextDueDate && date(plan.nextDueDate)! <= period.asOfDate);
      if (freshness.stale && matchesStockBatch) staleCount += 1; if (due && matchesStockBatch) outcomeDueCount += 1;
      if (added || completed || (status && STOCK_STATUSES.includes(status as typeof STOCK_STATUSES[number]) && matchesStockBatch)) demandRows.push({ businessNo: demand.businessNo, title: demand.title, enterprise: demand.enterprise.name,
        area: demand.responsibleArea.name, demandType: demand.demandType, urgency: demand.urgency, added: added ? "是" : "否", completed: completed ? "是" : "否", statusAt: status,
        stale: freshness.stale ? "是" : "否", outcomeDue: due ? "是" : "否", responsibility: owner ? `CURRENT_OWNER / ${owner.personName}` : handler ? `ALUMNI_TOWNSHIP / ${handler.person.name}` : "—",
        lastProgressAt: date(freshness.latestProgressAt), completedAt: date(closeApprovedAt), creationBatch: demand.creationBatch.name, completionBatch: demand.completionBatch?.name ?? null });
    }

    const enterprises = await loadReportPages((cursor) => this.prisma.enterprise.findMany({ where: { createdAt: { lte: period.asOf } }, orderBy: { id: "asc" }, take: REPORT_PAGE_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { versions: { where: { createdAt: { lte: period.asOf } }, orderBy: [{ createdAt: "desc" }, { versionNo: "desc" }], take: 1 } } }));
    let enterpriseTotal = 0; let enterpriseNormal = 0;
    for (const enterprise of enterprises) {
      const version = enterprise.versions[0]; const snapshot = asRecord(version?.snapshotJson); const historicalStatus = typeof snapshot?.status === "string" ? snapshot.status : null;
      const historicalAreaId = typeof snapshot?.responsibleAreaId === "string" ? snapshot.responsibleAreaId : null;
      if (areaIds !== null && !historicalAreaId) { warnings.add("ENTERPRISE_AREA_ASOF_MISSING"); continue; }
      if (areaIds !== null && !areaIds.includes(historicalAreaId!)) continue;
      enterpriseTotal += 1;
      if (!historicalStatus) warnings.add("ENTERPRISE_STATUS_ASOF_LIMITED"); else if (historicalStatus === "NORMAL") enterpriseNormal += 1;
    }

    const effectiveBatches = query.batchId ? [query.batchId] : (await this.prisma.batch.findMany({ where: { startDate: { lte: period.asOf }, OR: [{ endDate: null }, { endDate: { gt: period.asOf } }] }, select: { id: true } })).map(({ id }) => id);
    if (!query.batchId && effectiveBatches.length !== 1) warnings.add("BATCH_AT_ASOF_INVALID");
    const memberBatchIds = query.batchId ? effectiveBatches : effectiveBatches.length === 1 ? effectiveBatches : [];
    const memberships = memberBatchIds.length ? await this.prisma.batchMembership.findMany({ where: { batchId: { in: memberBatchIds }, startDate: { lte: period.asOf }, OR: [{ endDate: null }, { endDate: { gt: period.asOf } }] }, include: { postOrganization: { include: { areaMappings: true, departmentAreaRelations: true } } } }) : [];
    const memberIds = new Set(memberships.filter((item) => areaIds === null || Boolean(item.postOrganization && [...item.postOrganization.areaMappings, ...item.postOrganization.departmentAreaRelations].some((mapping) => areaIds.includes(mapping.areaId) && effective(mapping.effectiveAt, mapping.expiredAt, period.asOf)))).map(({ personId }) => personId));

    const presences = await loadReportPages((cursor) => this.prisma.presenceReport.findMany({ where: { sourceSystem: "V2", OR: [
      { arrivalAt: { gte: period.monthStart, lt: period.monthEndExclusive } },
      { arrivalAt: { lte: period.asOf }, expectedDepartureAt: { gt: period.asOf } },
    ], ...(period.current ? {} : { createdAt: { lte: period.asOf } }) }, orderBy: { id: "asc" }, take: REPORT_PAGE_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { person: { include: { appointments: { include: { organization: { include: { areaMappings: true, departmentAreaRelations: true } } } }, batchMemberships: { include: { postOrganization: { include: { areaMappings: true, departmentAreaRelations: true } } } } } } } }));
    let arrivalVisits = 0; const presentPeople = new Set<string>();
    for (const presence of presences) {
      const uncanceledAtArrival = !presence.canceledAt || presence.canceledAt > period.asOf;
      const arrival = inPeriod(presence.arrivalAt, period) && uncanceledAtArrival;
      const present = presence.arrivalAt <= period.asOf && period.asOf < presence.expectedDepartureAt && uncanceledAtArrival;
      if (!arrival && !present) continue;
      const at = present ? period.asOf : presence.arrivalAt; const attribution = personAreasAt(presence.person, at);
      const allowed = areaIds === null || (attribution.length === 1 && areaIds.includes(attribution[0]));
      if (areaIds !== null && attribution.length !== 1) warnings.add("PRESENCE_AREA_ATTRIBUTION_MISSING");
      if (allowed && arrival) arrivalVisits += 1; if (allowed && present) presentPeople.add(presence.personId);
    }

    const trips = await loadReportPages((cursor) => this.prisma.trip.findMany({ where: { nodes: { some: { plannedStartAt: { gte: period.monthStart, lt: period.monthEndExclusive } } }, OR: [{ canceledAt: null }, { canceledAt: { gt: period.asOf } }] }, orderBy: { id: "asc" }, take: REPORT_PAGE_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: {
      participants: { include: { person: { select: { name: true } } } }, nodes: { include: { enterprise: { include: { responsibleArea: { select: { id: true, name: true } } } } }, orderBy: { sequenceNo: "asc" } },
      visits: { where: { visitedAt: { gte: period.monthStart, lt: period.monthEndExclusive } }, include: { enterprise: { include: { responsibleArea: { select: { id: true, name: true } } } }, demandLeads: { where: { sourceType: "MEMBER_VISIT", sourceAt: { gte: period.monthStart, lt: period.monthEndExclusive } } } } }, result: true,
    } }));
    const tripIds = new Set<string>(); const participantRelations = new Set<string>(); const participantPeople = new Set<string>(); const visitedEnterprises = new Set<string>(); let leadCount = 0;
    const tripRows: MonthlyReportData["rows"]["trips"] = [];
    for (const trip of trips) {
      const tripAt = trip.nodes[0]?.plannedStartAt; if (!tripAt) continue;
      const visits = trip.visits.filter((visit) => selected(areaIds, visit.enterprise.responsibleAreaId));
      const nodes = areaIds === null ? trip.nodes : trip.nodes.filter((node) => node.enterprise && areaIds.includes(node.enterprise.responsibleAreaId));
      if (areaIds !== null && visits.length === 0 && nodes.length === 0) continue;
      tripIds.add(trip.id);
      const participants = trip.participants.filter((item) => item.joinedAt <= tripAt && (item.leftAt === null || item.leftAt > tripAt));
      participants.forEach((item) => { participantRelations.add(item.id); participantPeople.add(item.personId); });
      visits.forEach((visit) => { visitedEnterprises.add(visit.enterpriseId); leadCount += visit.demandLeads.length; });
      tripRows.push({ date: date(tripAt), trip: `${trip.id} / ${trip.title}`, participants: participants.map((item) => item.person.name).join("、"),
        enterprises: nodes.map((node) => node.enterprise?.name ?? node.locationName).join("、"), areas: [...new Set(visits.map((visit) => visit.enterprise.responsibleArea.name))].join("、"),
        result: areaIds === null ? trip.result?.resultSummary ?? null : visits.map((visit) => visit.visitSummary).filter(Boolean).join("；"), leadCount: visits.reduce((sum, visit) => sum + visit.demandLeads.length, 0) });
    }

    const talents = await loadReportPages((cursor) => this.prisma.talent.findMany({ where: { OR: [
      { createdAt: { gte: period.monthStart, lt: period.monthEndExclusive } },
      { townshipRounds: { some: { startedAt: { lte: period.asOf }, AND: [
        { OR: [{ voidedAt: null }, { voidedAt: { gt: period.asOf } }] },
        { OR: [
          { completedAt: { gte: period.monthStart, lt: period.monthEndExclusive } },
          { AND: [{ OR: [{ completedAt: null }, { completedAt: { gt: period.asOf } }] }, { OR: [{ withdrawnAt: null }, { withdrawnAt: { gt: period.asOf } }] }] },
        ] },
      ] } } },
    ] }, orderBy: { id: "asc" }, take: REPORT_PAGE_SIZE, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), include: { townshipRounds: { include: { area: { select: { name: true } }, currentHandlerPerson: { select: { name: true } } }, orderBy: [{ startedAt: "asc" }, { roundNo: "asc" }] } } }));
    let talentAdded = 0; let completedRounds = 0; let inProgressRounds = 0; let domestic = 0; let overseas = 0; const talentRows: MonthlyReportData["rows"]["talents"] = [];
    for (const talent of talents) {
      const relevantAreas = new Set(talent.townshipRounds.filter((round) => round.startedAt <= period.asOf && (!round.voidedAt || round.voidedAt > period.asOf)).map(({ areaId }) => areaId));
      const addedInMonth = inPeriod(talent.createdAt, period);
      const addedAllowed = areaIds === null || [...relevantAreas].some((areaId) => areaIds.includes(areaId));
      if (addedInMonth && areaIds !== null && relevantAreas.size === 0) warnings.add("TALENT_AREA_ATTRIBUTION_MISSING");
      if (addedInMonth && addedAllowed) { talentAdded += 1; if (talent.scopeType === "DOMESTIC") domestic += 1; else overseas += 1; }
      for (const round of talent.townshipRounds) {
        if (!selected(areaIds, round.areaId) || round.startedAt > period.asOf || (round.voidedAt && round.voidedAt <= period.asOf)) continue;
        const completed = Boolean(round.completedAt && round.completedAt <= period.asOf); const withdrawn = Boolean(round.withdrawnAt && round.withdrawnAt <= period.asOf);
        const roundStatus = completed ? "COMPLETED" : withdrawn ? "WITHDRAWN" : "IN_PROGRESS";
        if (inPeriod(round.completedAt, period)) completedRounds += 1; if (roundStatus === "IN_PROGRESS") inProgressRounds += 1;
        if (inPeriod(round.completedAt, period) || roundStatus === "IN_PROGRESS" || (addedInMonth && addedAllowed)) talentRows.push({ talent: talent.name, scope: talent.scopeType, organization: talent.organizationName,
          direction: talent.professionalDirection, area: round.area.name, roundNo: round.roundNo, status: roundStatus, startedAt: date(round.startedAt), completedAt: date(round.completedAt), handler: round.currentHandlerPerson.name, result: round.resultSummary });
      }
    }

    const outcomeRounds = await this.prisma.demandOutcomeRound.findMany({ where: { reviewStatus: "APPROVED", reviewedAt: { lte: period.asOf }, trackingDate: { gte: period.monthStart, lt: period.monthEndExclusive }, ...(query.batchId ? { trackingBatchId: query.batchId } : {}), demand: areaIds ? { responsibleAreaId: { in: areaIds } } : {} },
      include: { demand: { include: { enterprise: { select: { name: true } }, responsibleArea: { select: { name: true } } } }, trackingBatch: { select: { name: true } } }, orderBy: [{ trackingDate: "asc" }, { demandId: "asc" }, { roundNo: "asc" }] });
    const sums = { contract: new PrismaRuntime.Decimal(0), investment: new PrismaRuntime.Decimal(0), policy: new PrismaRuntime.Decimal(0), cost: new PrismaRuntime.Decimal(0), talent: 0, patent: 0 };
    const outcomeRows: MonthlyReportData["rows"]["outcomes"] = outcomeRounds.map((round) => {
      sums.contract = sums.contract.plus(round.contractAmountIncrement); sums.investment = sums.investment.plus(round.investmentAmountIncrement); sums.policy = sums.policy.plus(round.policyFundIncrement); sums.cost = sums.cost.plus(round.costReductionIncrement); sums.talent += round.talentIntroducedIncrement; sums.patent += round.patentIncrement;
      return { businessNo: round.demand.businessNo, title: round.demand.title, enterprise: round.demand.enterprise.name, area: round.demand.responsibleArea.name, roundNo: round.roundNo, trackingDate: date(round.trackingDate), trackingBatch: round.trackingBatch.name,
        contractAmount: round.contractAmountIncrement.toFixed(2), investmentAmount: round.investmentAmountIncrement.toFixed(2), policyFund: round.policyFundIncrement.toFixed(2), costReduction: round.costReductionIncrement.toFixed(2),
        talentIntroduced: round.talentIntroducedIncrement, patent: round.patentIncrement, qualitativeResult: round.qualitativeResult, enterpriseFeedback: round.enterpriseFeedback, reviewedAt: dateTime(round.reviewedAt) };
    });
    return { period: { month: period.month, asOf: period.asOfDate, current: period.current }, filters: { batchId: query.batchId ?? null, batchName: batch?.name ?? null, areaIds, areaNames: areaRows.map(({ name }) => name) },
      overview: { demand: { added: demandAdded, completed: demandCompleted, stock, stale: staleCount, outcomeDue: outcomeDueCount }, resources: { enterpriseTotal, enterpriseNormal, memberCount: memberIds.size, arrivalVisits, presentPeople: presentPeople.size },
        trips: { tripCount: tripIds.size, participantVisits: participantRelations.size, distinctParticipants: participantPeople.size, distinctEnterprises: visitedEnterprises.size, leadCount },
        talent: { added: talentAdded, completedRounds, inProgressRounds, domestic, overseas }, outcome: { contractAmount: sums.contract.toFixed(2), investmentAmount: sums.investment.toFixed(2), policyFund: sums.policy.toFixed(2), costReduction: sums.cost.toFixed(2), talentIntroduced: sums.talent, patent: sums.patent } },
      rows: { demands: demandRows, trips: tripRows, talents: talentRows, outcomes: outcomeRows }, warnings: warnings.list() };
  }
}
