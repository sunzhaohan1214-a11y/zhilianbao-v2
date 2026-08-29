import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { findSystemCommand, requireIdempotencyKey, saveSystemCommand, stableHash } from "./command";
import { SystemError } from "./errors";
import { calendarConfirmSchema, calendarPreviewSchema } from "./schemas";
import type { SystemMutationContext } from "./types";

type Input = { actor: PermissionActor; context?: SystemMutationContext };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
function dateKey(value: string): string { if (!DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new SystemError("SYSTEM_PREVIEW_STALE", "日期格式必须为 YYYY-MM-DD"); return value; }
function utcDate(value: string): Date { return new Date(`${dateKey(value)}T00:00:00.000Z`); }
function key(value: Date): string { return value.toISOString().slice(0, 10); }
export function isDefaultWorkday(value: string): boolean { const day = utcDate(value).getUTCDay(); return day >= 1 && day <= 5; }

export class WorkCalendarService {
  constructor(private readonly prisma = getPrismaClient()) {}
  async isWorkday(value: string): Promise<boolean> { const override = await this.prisma.workCalendarOverride.findUnique({ where: { date: utcDate(value) } }); return override ? override.dayType === "WORKDAY" : isDefaultWorkday(value); }
  async addWorkdays(value: string, count: number): Promise<string> { let remaining = count; const cursor = utcDate(value); const direction = count < 0 ? -1 : 1; remaining = Math.abs(remaining); while (remaining > 0) { cursor.setUTCDate(cursor.getUTCDate() + direction); if (await this.isWorkday(key(cursor))) remaining -= 1; } return key(cursor); }
  async listOverrides(input: Input & { year: number }) { await authorizeActor({ actor: input.actor, action: "system.health.view", resource: { resourceType: "work-calendar", requiredScope: "SYSTEM" } }); const start = new Date(Date.UTC(input.year, 0, 1)); const end = new Date(Date.UTC(input.year + 1, 0, 1)); return this.prisma.workCalendarOverride.findMany({ where: { date: { gte: start, lt: end } }, orderBy: { date: "asc" } }); }
  async preview(input: Input & { date: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "system.high_privilege_manage", resource: { resourceType: "work-calendar", requiredScope: "SYSTEM" } });
    const date = dateKey(input.date); const body = calendarPreviewSchema.parse(input.body); const current = await this.prisma.workCalendarOverride.findUnique({ where: { date: utcDate(date) } }); const version = current?.version ?? 0;
    if (version !== body.expectedVersion) throw new SystemError("WORK_CALENDAR_VERSION_CONFLICT", "工作日历版本已变化", { expectedVersion: body.expectedVersion, currentVersion: version });
    const payload = { date, before: current ? { dayType: current.dayType, name: current.name } : { dayType: isDefaultWorkday(date) ? "WORKDAY" : "HOLIDAY", name: null }, after: { dayType: body.dayType, name: body.name ?? null }, expectedVersion: version, reason: body.reason };
    return { ...payload, impact: ["使用该自然日计算的后续审核时限会采用覆盖规则", "历史已生成期限不回写"], previewToken: stableHash(payload) };
  }
  async confirm(input: Input & { date: string; body: unknown; idempotencyKey: string | null }) {
    await authorizeActor({ actor: input.actor, action: "system.high_privilege_manage", resource: { resourceType: "work-calendar", requiredScope: "SYSTEM" } });
    const date = dateKey(input.date); const dateValue = utcDate(date); const body = calendarConfirmSchema.parse(input.body); const keyHash = requireIdempotencyKey(input.idempotencyKey); const payloadHash = stableHash({ date, ...body, previewToken: undefined });
    return this.prisma.$transaction(async (tx) => {
      const replay = await findSystemCommand(tx, { actorPersonId: input.actor.personId, action: "WORK_CALENDAR_CONFIRM", keyHash, payloadHash }); if (replay) return replay.responseJson;
      if (body.expectedVersion === 0) {
        const existing = await tx.workCalendarOverride.findUnique({ where: { date: dateValue } });
        if (existing) throw new SystemError("WORK_CALENDAR_VERSION_CONFLICT", "工作日历版本已变化", { currentVersion: existing.version });
      } else await tx.$queryRaw`SELECT id FROM work_calendar_overrides WHERE date = ${dateValue} FOR UPDATE`;
      const current = await tx.workCalendarOverride.findUnique({ where: { date: dateValue } }); const version = current?.version ?? 0;
      if (version !== body.expectedVersion) throw new SystemError("WORK_CALENDAR_VERSION_CONFLICT", "工作日历版本已变化", { expectedVersion: body.expectedVersion, currentVersion: version });
      const before = current ? { dayType: current.dayType, name: current.name } : { dayType: isDefaultWorkday(date) ? "WORKDAY" : "HOLIDAY", name: null };
      const tokenPayload = { date, before, after: { dayType: body.dayType, name: body.name ?? null }, expectedVersion: version, reason: body.reason };
      if (stableHash(tokenPayload) !== body.previewToken) throw new SystemError("SYSTEM_PREVIEW_STALE", "影响预览已失效，请重新预览");
      let updated;
      try {
        updated = current
          ? await tx.workCalendarOverride.update({ where: { id: current.id }, data: { dayType: body.dayType, name: body.name ?? null, reason: body.reason, version: { increment: 1 }, updatedByPersonId: input.actor.personId } })
          : await tx.workCalendarOverride.create({ data: { date: dateValue, dayType: body.dayType, name: body.name ?? null, reason: body.reason, version: 1, updatedByPersonId: input.actor.personId } });
      } catch (error) {
        if (typeof error === "object" && error && "code" in error && error.code === "P2002") throw new SystemError("WORK_CALENDAR_VERSION_CONFLICT", "工作日历版本已变化");
        throw error;
      }
      await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "WORK_CALENDAR_OVERRIDE_CHANGED", entityType: "WORK_CALENDAR_OVERRIDE", entityId: updated.id, beforeJson: before as Prisma.InputJsonValue, afterJson: { date, dayType: updated.dayType, name: updated.name, version: updated.version }, reason: body.reason, requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } });
      const response = { date, dayType: updated.dayType, name: updated.name, version: updated.version } as Prisma.InputJsonValue;
      await saveSystemCommand(tx, { actorPersonId: input.actor.personId, action: "WORK_CALENDAR_CONFIRM", keyHash, payloadHash, aggregateType: "WORK_CALENDAR_OVERRIDE", aggregateId: updated.id, response }); return response;
    });
  }
}
