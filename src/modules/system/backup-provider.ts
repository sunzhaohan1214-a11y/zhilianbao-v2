import { createHash } from "node:crypto";
import type { BackupType } from "@/generated/prisma/client";
import { TencentCynosDbBackupProvider } from "./tencent-cynosdb-backup-provider";
import { CURRENT_SCHEMA_VERSION, currentAppVersion, currentRuntimeEnvironment, fakeSystemProvidersEnabled } from "./runtime";

export type ProviderHealth = {
  ready: boolean; backupReady?: boolean; restoreReady?: boolean;
  status: "READY" | "NOT_CONFIGURED" | "DEGRADED"; provider: string; detail?: string;
};
export type ProviderBackup = {
  providerBackupId: string; backupType: BackupType; sourceEnvironment: string;
  status: "RUNNING" | "SUCCEEDED" | "FAILED"; snapshotAt: Date;
  correlationId?: string; schemaVersion?: string; appVersion?: string; retentionUntil?: Date; verifiedAt?: Date; errorCode?: string;
};
export type RestoreProviderStatus = { status: "RUNNING" | "SUCCEEDED" | "FAILED"; errorCode?: string };
export interface BackupProvider {
  health(): Promise<ProviderHealth>; listBackups(): Promise<ProviderBackup[]>;
  createSnapshot(input: { backupType: BackupType; reason: string; idempotencyKey: string }): Promise<ProviderBackup>;
  getBackup(providerBackupId: string): Promise<ProviderBackup | null>;
  previewRestore(providerBackupId: string): Promise<{ ready: boolean; detail?: string }>;
  startRestore(providerBackupId: string, idempotencyKey: string): Promise<{ operationId: string }>;
  getRestoreStatus(operationId: string): Promise<RestoreProviderStatus>;
}
export class UnavailableBackupProvider implements BackupProvider {
  async health(): Promise<ProviderHealth> { return { ready: false, status: "NOT_CONFIGURED", provider: "unavailable", detail: "未配置正式云快照适配器" }; }
  async listBackups(): Promise<ProviderBackup[]> { return []; } async createSnapshot(): Promise<never> { throw new Error("BACKUP_PROVIDER_UNAVAILABLE"); }
  async getBackup(): Promise<null> { return null; } async previewRestore(): Promise<{ ready: false; detail: string }> { return { ready: false, detail: "未配置正式云快照适配器" }; }
  async startRestore(): Promise<never> { throw new Error("BACKUP_PROVIDER_UNAVAILABLE"); }
  async getRestoreStatus(): Promise<RestoreProviderStatus> { return { status: "FAILED", errorCode: "BACKUP_PROVIDER_UNAVAILABLE" }; }
}
type FakeOptions = { failCreate?: boolean; failRestore?: boolean; ready?: boolean; previewReady?: boolean; throwAfterCreateSideEffectOnce?: boolean; throwAfterRestoreSideEffectOnce?: boolean; sourceEnvironment?: string; schemaVersion?: string; appVersion?: string };
export class FakeBackupProvider implements BackupProvider {
  readonly snapshots: ProviderBackup[] = []; readonly createCalls: string[] = []; readonly restoreCalls: string[] = [];
  private readonly snapshotsByKey = new Map<string, ProviderBackup>(); private readonly operationsByKey = new Map<string, { providerBackupId: string; operationId: string }>(); private readonly operations = new Map<string, RestoreProviderStatus>();
  private previewReady: boolean; private threwAfterCreateSideEffect = false; private threwAfterSideEffect = false;
  constructor(private readonly options: FakeOptions = {}) { this.previewReady = options.previewReady ?? true; }
  setReady(ready: boolean) { this.options.ready = ready; } setPreviewReady(ready: boolean) { this.previewReady = ready; }
  async health(): Promise<ProviderHealth> { return this.options.ready === false ? { ready: false, status: "DEGRADED", provider: "fake" } : { ready: true, status: "READY", provider: "fake" }; }
  async listBackups() { return [...this.snapshots]; }
  async createSnapshot(input: { backupType: BackupType; reason: string; idempotencyKey: string }): Promise<ProviderBackup> {
    this.createCalls.push(input.idempotencyKey); const existing = this.snapshotsByKey.get(input.idempotencyKey); if (existing) return existing;
    if (this.options.failCreate) throw new Error("FAKE_BACKUP_FAILED"); const now = new Date();
    const correlationId = `fake-${createHash("sha256").update(input.idempotencyKey).digest("hex")}`;
    const item: ProviderBackup = { providerBackupId: correlationId, correlationId, backupType: input.backupType, sourceEnvironment: this.options.sourceEnvironment ?? currentRuntimeEnvironment(), status: "SUCCEEDED", snapshotAt: now, schemaVersion: this.options.schemaVersion ?? CURRENT_SCHEMA_VERSION, appVersion: this.options.appVersion ?? currentAppVersion() };
    this.snapshotsByKey.set(input.idempotencyKey, item); this.snapshots.push(item); if (this.options.throwAfterCreateSideEffectOnce && !this.threwAfterCreateSideEffect) { this.threwAfterCreateSideEffect = true; throw new Error("FAKE_NETWORK_UNKNOWN_AFTER_BACKUP_SIDE_EFFECT"); } return item;
  }
  addProviderBackup(item: ProviderBackup) { if (!this.snapshots.some((entry) => entry.providerBackupId === item.providerBackupId)) this.snapshots.push(item); }
  async getBackup(id: string) { return this.snapshots.find((item) => item.providerBackupId === id) ?? null; }
  async previewRestore(id: string) { return { ready: this.previewReady && this.snapshots.some((item) => item.providerBackupId === id), detail: "TEST fake provider preview" }; }
  async startRestore(id: string, idempotencyKey: string) {
    this.restoreCalls.push(idempotencyKey); const existing = this.operationsByKey.get(idempotencyKey);
    if (existing) { if (existing.providerBackupId !== id) throw new Error("RESTORE_IDEMPOTENCY_CONFLICT"); return { operationId: existing.operationId }; }
    if (this.options.failRestore) throw new Error("FAKE_RESTORE_FAILED");
    const operationId = `restore-${createHash("sha256").update(idempotencyKey).digest("hex")}`; this.operationsByKey.set(idempotencyKey, { providerBackupId: id, operationId }); this.operations.set(operationId, { status: "SUCCEEDED" });
    if (this.options.throwAfterRestoreSideEffectOnce && !this.threwAfterSideEffect) { this.threwAfterSideEffect = true; throw new Error("FAKE_NETWORK_UNKNOWN_AFTER_SIDE_EFFECT"); }
    return { operationId };
  }
  async getRestoreStatus(id: string) { return this.operations.get(id) ?? { status: "FAILED" as const, errorCode: "RESTORE_OPERATION_NOT_FOUND" }; }
}
const runtime = globalThis as typeof globalThis & { __zlbBackupProvider?: BackupProvider };
export function getBackupProvider(): BackupProvider {
  if (runtime.__zlbBackupProvider) return runtime.__zlbBackupProvider;
  if (fakeSystemProvidersEnabled()) runtime.__zlbBackupProvider = new FakeBackupProvider();
  else if (process.env.BACKUP_PROVIDER === "tencent-cynosdb") runtime.__zlbBackupProvider = TencentCynosDbBackupProvider.fromEnvironment();
  else runtime.__zlbBackupProvider = new UnavailableBackupProvider();
  return runtime.__zlbBackupProvider;
}
