import type { Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import { findSystemCommand, requireIdempotencyKey, saveSystemCommand, stableHash } from "./command";
import { SystemError } from "./errors";
import { isSystemSettingKey, SYSTEM_SETTING_REGISTRY, type SystemSettingKey } from "./setting-registry";
import { settingConfirmSchema, settingPreviewSchema } from "./schemas";
import type { SystemMutationContext } from "./types";

type Input = { actor: PermissionActor; context?: SystemMutationContext };
function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }

export class SettingsService {
  constructor(private readonly prisma = getPrismaClient()) {}

  async list(input: Input) {
    await authorizeActor({ actor: input.actor, action: "system.health.view", resource: { resourceType: "system-setting", requiredScope: "SYSTEM" } });
    const rows = new Map((await this.prisma.systemSetting.findMany()).map((row) => [row.key, row]));
    return Object.entries(SYSTEM_SETTING_REGISTRY).map(([key, definition]) => {
      const row = rows.get(key);
      return { key, value: row?.valueJson ?? definition.default, valueType: definition.type, version: row?.version ?? 0, initialized: Boolean(row), editable: definition.editable && input.actor.capabilities.has("system.high_privilege_manage"), runtimeStatus: "runtimeStatus" in definition ? definition.runtimeStatus : "WIRED", riskLevel: definition.riskLevel, description: definition.description };
    });
  }

  private definition(key: string) {
    if (!isSystemSettingKey(key)) throw new SystemError("SYSTEM_SETTING_UNKNOWN", "系统配置项不存在");
    return { key, definition: SYSTEM_SETTING_REGISTRY[key] } as { key: SystemSettingKey; definition: (typeof SYSTEM_SETTING_REGISTRY)[SystemSettingKey] };
  }

  async preview(input: Input & { key: string; body: unknown }) {
    await authorizeActor({ actor: input.actor, action: "system.high_privilege_manage", resource: { resourceType: "system-setting", requiredScope: "SYSTEM" } });
    const { key, definition } = this.definition(input.key);
    if (!definition.editable) throw new SystemError("SYSTEM_SETTING_READ_ONLY", "该系统配置为只读");
    const body = settingPreviewSchema.parse(input.body);
    const value = definition.schema.parse(body.value);
    const row = await this.prisma.systemSetting.findUnique({ where: { key } });
    const version = row?.version ?? 0;
    if (version !== body.expectedVersion) throw new SystemError("SYSTEM_SETTING_VERSION_CONFLICT", "配置版本已变化，请刷新后重试", { expectedVersion: body.expectedVersion, currentVersion: version });
    const payload = { key, before: row?.valueJson ?? definition.default, after: value, expectedVersion: version, reason: body.reason };
    return { ...payload, impact: definition.riskLevel === "HIGH" ? ["后续新业务计算将采用新值", "历史业务快照不回写"] : ["管理端展示值将更新"], previewToken: stableHash(payload) };
  }

  async confirm(input: Input & { key: string; body: unknown; idempotencyKey: string | null }) {
    await authorizeActor({ actor: input.actor, action: "system.high_privilege_manage", resource: { resourceType: "system-setting", requiredScope: "SYSTEM" } });
    const { key, definition } = this.definition(input.key);
    if (!definition.editable) throw new SystemError("SYSTEM_SETTING_READ_ONLY", "该系统配置为只读");
    const body = settingConfirmSchema.parse(input.body);
    const value = definition.schema.parse(body.value);
    const payload = { key, before: undefined, after: value, expectedVersion: body.expectedVersion, reason: body.reason };
    const keyHash = requireIdempotencyKey(input.idempotencyKey); const payloadHash = stableHash({ key, value, expectedVersion: body.expectedVersion, reason: body.reason });
    return this.prisma.$transaction(async (tx) => {
      const existingCommand = await findSystemCommand(tx, { actorPersonId: input.actor.personId, action: "SYSTEM_SETTING_CONFIRM", keyHash, payloadHash });
      if (existingCommand) return existingCommand.responseJson;
      await tx.systemSetting.upsert({ where: { key }, create: { key, valueType: definition.type, version: 0, updatedByPersonId: input.actor.personId, ...(definition.default === null ? {} : { valueJson: json(definition.default) }) }, update: {} });
      await tx.$queryRaw`SELECT id FROM system_settings WHERE \`key\` = ${key} FOR UPDATE`;
      const current = await tx.systemSetting.findUniqueOrThrow({ where: { key } });
      if (current.version !== body.expectedVersion) throw new SystemError("SYSTEM_SETTING_VERSION_CONFLICT", "配置版本已变化，请刷新后重试", { expectedVersion: body.expectedVersion, currentVersion: current.version });
      const tokenPayload = { ...payload, before: current.valueJson ?? definition.default };
      if (stableHash(tokenPayload) !== body.previewToken) throw new SystemError("SYSTEM_PREVIEW_STALE", "影响预览已失效，请重新预览");
      const nextVersion = current.version + 1;
      const updated = await tx.systemSetting.update({ where: { id: current.id }, data: { valueJson: json(value), valueType: definition.type, version: nextVersion, updatedByPersonId: input.actor.personId } });
      await tx.systemSettingVersion.create({ data: { settingId: current.id, version: nextVersion, beforeJson: current.valueJson === null ? undefined : json(current.valueJson), afterJson: json(value), reason: body.reason, changedByPersonId: input.actor.personId } });
      await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "SYSTEM_SETTING_CHANGED", entityType: "SYSTEM_SETTING", entityId: current.id, beforeJson: json({ key, value: current.valueJson ?? definition.default, version: current.version }), afterJson: json({ key, value, version: nextVersion }), reason: body.reason, requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } });
      const response = json({ key, value: updated.valueJson, version: updated.version });
      await saveSystemCommand(tx, { actorPersonId: input.actor.personId, action: "SYSTEM_SETTING_CONFIRM", keyHash, payloadHash, aggregateType: "SYSTEM_SETTING", aggregateId: current.id, response });
      return response;
    });
  }
}

export async function getPublicAdminContactPhone(): Promise<string> {
  const fallback = process.env.ADMIN_CONTACT_PHONE ?? "0514-XXXXXXXX";
  try { const row = await getPrismaClient().systemSetting.findUnique({ where: { key: "system.admin_contact_phone" }, select: { valueJson: true } }); return typeof row?.valueJson === "string" && row.valueJson.trim() ? row.valueJson : fallback; } catch { return fallback; }
}
