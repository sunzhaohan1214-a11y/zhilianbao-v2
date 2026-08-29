import type { BackupRecord, BackupType, Prisma } from "@/generated/prisma/client";
import { getPrismaClient } from "@/lib/db/prisma";
import { authorizeActor } from "@/modules/permissions/authorization";
import type { PermissionActor } from "@/modules/permissions/types";
import type { BackupProvider, ProviderBackup } from "./backup-provider"; import { getBackupProvider } from "./backup-provider";
import { findSystemCommand, requireIdempotencyKey, saveSystemCommand, stableHash } from "./command";
import { SystemError } from "./errors"; import { manualBackupSchema } from "./schemas";
import { currentAppVersion, currentRuntimeEnvironment } from "./runtime"; import type { SystemMutationContext } from "./types";

type Input = { actor: PermissionActor; context?: SystemMutationContext };
type Check = { status: "PASS" | "FAIL" | "UNKNOWN"; detail: string };
function isUnique(error: unknown) { return typeof error === "object" && error !== null && "code" in error && error.code === "P2002"; }
function ageDays(date: Date, now: Date) { return (now.getTime() - date.getTime()) / 86_400_000; }
function retentionCheck(rows: BackupRecord[], minimumDays: number, now: Date, label: string): Check {
  if (!rows.length) return { status: "UNKNOWN", detail: `${label}：无可验证备份证据` };
  if (rows.some((row) => !row.retentionUntil)) return { status: "UNKNOWN", detail: `${label}：Provider 未提供保留策略证据` };
  return rows.some((row) => row.retentionUntil!.getTime() >= row.requestedAt.getTime() + minimumDays * 86_400_000)
    ? { status: "PASS", detail: `${label}证据满足` } : { status: "FAIL", detail: `${label}证据不足` };
}
export function backupPolicyCompliance(providerReady: boolean, rows: BackupRecord[], now = new Date()) {
  const succeeded = rows.filter((row) => row.status === "SUCCEEDED"); const latest = succeeded[0];
  const checks: Record<string, Check> = {
    rpo24h: !providerReady ? { status: "UNKNOWN", detail: "Provider 未就绪" } : !latest?.completedAt ? { status: "FAIL", detail: "没有成功备份" } : ageDays(latest.completedAt, now) <= 1 ? { status: "PASS", detail: "最近成功备份在 24 小时内" } : { status: "FAIL", detail: "最近成功备份超过 24 小时" },
    weeklyFull: succeeded.filter((row) => row.backupType === "AUTO_FULL").length === 0 ? { status: "UNKNOWN", detail: "无自动周全备证据" } : succeeded.some((row) => row.backupType === "AUTO_FULL" && row.snapshotAt && ageDays(row.snapshotAt, now) <= 7) ? { status: "PASS", detail: "最近 7 天有自动全备" } : { status: "FAIL", detail: "最近 7 天无自动全备" },
    incrementalRetention30d: retentionCheck(succeeded.filter((row) => row.backupType === "AUTO_INCREMENTAL"), 30, now, "增量保留 30 天"),
    fullRetention12w: retentionCheck(succeeded.filter((row) => row.backupType === "AUTO_FULL"), 84, now, "全量保留 12 周"),
    criticalRetention180d: retentionCheck(succeeded.filter((row) => ["PRE_RELEASE", "PRE_MIGRATION", "PRE_IMPORT", "PRE_BATCH_SWITCH"].includes(row.backupType)), 180, now, "关键操作保留 180 天"),
  };
  const statuses = Object.values(checks).map((item) => item.status); const compliance = statuses.includes("FAIL") ? "DEGRADED" : statuses.every((status) => status === "PASS") ? "COMPLIANT" : "UNKNOWN";
  return { checks, compliance, ageHours: latest?.completedAt ? Math.round((now.getTime() - latest.completedAt.getTime()) / 3_600_000) : null };
}
export class BackupService {
  constructor(private readonly prisma = getPrismaClient(), private readonly provider: BackupProvider = getBackupProvider()) {}
  async health() { const provider = await this.provider.health(); const runtimeEnvironment = currentRuntimeEnvironment(); const rows = await this.prisma.backupRecord.findMany({ where: { status: "SUCCEEDED", provider: provider.provider, sourceEnvironment: runtimeEnvironment }, orderBy: { completedAt: "desc" }, take: 500 }); const policy = backupPolicyCompliance(provider.ready, rows); return { provider, expectedPolicy: { incrementalRetentionDays: 30, fullRetentionWeeks: 12, criticalRetentionDays: 180, rpoHours: 24, rtoHours: 8 }, compliance: policy.compliance, complianceChecks: policy.checks, lastSuccessfulBackupAt: rows[0]?.completedAt ?? null, lastSuccessfulBackupAgeHours: policy.ageHours, lastRestoreDrillAt: null }; }
  async list(input: Input) { await authorizeActor({ actor: input.actor, action: "backup.manage", resource: { resourceType: "backup", requiredScope: "SYSTEM" } }); return { health: await this.health(), items: await this.prisma.backupRecord.findMany({ orderBy: { requestedAt: "desc" }, take: 100 }) }; }
  async requestManual(input: Input & { body: unknown; idempotencyKey: string | null }) { await authorizeActor({ actor: input.actor, action: "backup.manage", resource: { resourceType: "backup", requiredScope: "SYSTEM" } }); const body = manualBackupSchema.parse(input.body); return this.request({ actor: input.actor, context: input.context, type: "MANUAL", reason: body.reason, idempotencyKey: input.idempotencyKey ?? "" }); }
  async requestPreOperation(input: Input & { type: "PRE_IMPORT" | "PRE_BATCH_SWITCH" | "PRE_MIGRATION" | "PRE_RELEASE"; reason: string; idempotencyKey: string }) { const backup = await this.request({ actor: input.actor, context: input.context, type: input.type, reason: input.reason, idempotencyKey: input.idempotencyKey }); if (backup.status !== "SUCCEEDED") throw new SystemError("BACKUP_NOT_READY", "预备份未成功，禁止继续高风险操作"); return backup; }
  private async request(input: Input & { type: BackupType; reason: string; idempotencyKey: string }) {
    const keyHash = requireIdempotencyKey(input.idempotencyKey); const action = `BACKUP_CREATE_${input.type}`; const payloadHash = stableHash({ type: input.type, reason: input.reason }); const providerHealth = await this.provider.health(); if (!providerHealth.ready) throw new SystemError("BACKUP_PROVIDER_UNAVAILABLE", "备份 Provider 未配置或不可用");
    let id: string;
    try { id = await this.prisma.$transaction(async (tx) => { const replay = await findSystemCommand(tx, { actorPersonId: input.actor.personId, action, keyHash, payloadHash }); if (replay) return (replay.responseJson as { backupRecordId: string }).backupRecordId;
      const row = await tx.backupRecord.create({ data: { provider: providerHealth.provider, backupType: input.type, sourceEnvironment: currentRuntimeEnvironment(), status: "REQUESTED", reason: input.reason, appVersion: currentAppVersion(), createdByPersonId: input.actor.personId } }); const response = { backupRecordId: row.id } as Prisma.InputJsonValue;
      await saveSystemCommand(tx, { actorPersonId: input.actor.personId, action, keyHash, payloadHash, aggregateType: "BACKUP_RECORD", aggregateId: row.id, response }); await tx.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "BACKUP_REQUESTED", entityType: "BACKUP_RECORD", entityId: row.id, afterJson: { backupType: input.type, sourceEnvironment: currentRuntimeEnvironment(), status: "REQUESTED" }, reason: input.reason, requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } }); return row.id; }); }
    catch (error) { if (!isUnique(error)) throw error; const replay = await this.prisma.systemCommandIdempotency.findUnique({ where: { actorPersonId_action_keyHash: { actorPersonId: input.actor.personId, action, keyHash } } }); if (!replay || replay.payloadHash !== payloadHash) throw new SystemError("SYSTEM_IDEMPOTENCY_CONFLICT", "Idempotency-Key 已用于不同备份命令"); id = (replay.responseJson as { backupRecordId: string }).backupRecordId; }
    return this.ensureSnapshotStarted(id);
  }
  async ensureSnapshotStarted(id: string) {
    const row = await this.prisma.backupRecord.findUniqueOrThrow({ where: { id } }); if (!["REQUESTED", "RUNNING"].includes(row.status)) return row;
    await this.prisma.backupRecord.update({ where: { id }, data: { status: "RUNNING", errorCode: null } });
    try { const result = await this.provider.createSnapshot({ backupType: row.backupType, reason: row.reason, idempotencyKey: row.id }); return this.prisma.backupRecord.update({ where: { id }, data: { providerBackupId: result.providerBackupId, status: result.status, snapshotAt: result.snapshotAt, schemaVersion: result.schemaVersion, appVersion: result.appVersion ?? row.appVersion, retentionUntil: result.retentionUntil, completedAt: result.status === "SUCCEEDED" ? new Date() : undefined, verifiedAt: result.verifiedAt, errorCode: result.errorCode } }); }
    catch { await this.prisma.backupRecord.update({ where: { id }, data: { errorCode: "BACKUP_PROVIDER_RETRY_REQUIRED" } }); throw new SystemError("BACKUP_PROVIDER_UNAVAILABLE", "云快照状态未知，可用同一 Idempotency-Key 续跑"); }
  }
  async sync(input: Input) {
    await authorizeActor({ actor: input.actor, action: "backup.manage", resource: { resourceType: "backup", requiredScope: "SYSTEM" } }); const health = await this.provider.health(); if (!health.ready) throw new SystemError("BACKUP_PROVIDER_UNAVAILABLE", "备份 Provider 不可用");
    const providerItems = await this.provider.listBackups(); let updated = 0; let created = 0;
    for (const item of providerItems) { const existing = await this.prisma.backupRecord.findUnique({ where: { provider_providerBackupId: { provider: health.provider, providerBackupId: item.providerBackupId } } }); const data = this.providerMetadata(item);
      if (existing) { await this.prisma.backupRecord.update({ where: { id: existing.id }, data }); updated += 1; } else { await this.prisma.backupRecord.create({ data: { provider: health.provider, reason: "PROVIDER_CATALOG_SYNC", createdByPersonId: null, ...data } }); created += 1; } }
    await this.prisma.auditLog.create({ data: { actorPersonId: input.actor.personId, actorAccountId: input.actor.accountId, actionCode: "BACKUP_SYNCED", entityType: "BACKUP_CATALOG", afterJson: { provider: health.provider, providerCount: providerItems.length, updated, created }, reason: "Provider catalog synchronization", requestId: input.context?.requestId, ip: input.context?.ip, device: input.context?.deviceName } }); return { providerCount: providerItems.length, updated, created };
  }
  private providerMetadata(item: ProviderBackup) { return { providerBackupId: item.providerBackupId, backupType: item.backupType, sourceEnvironment: item.sourceEnvironment, status: item.status, snapshotAt: item.snapshotAt, schemaVersion: item.schemaVersion, appVersion: item.appVersion, retentionUntil: item.retentionUntil, verifiedAt: item.verifiedAt, errorCode: item.errorCode, completedAt: item.status === "RUNNING" ? null : item.snapshotAt }; }
}
