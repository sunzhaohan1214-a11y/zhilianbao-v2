export type ProviderHealth = { ready: boolean; status: "READY" | "NOT_CONFIGURED" | "DEGRADED"; provider: string; detail?: string };
export type ProviderBackup = { providerBackupId: string; status: "RUNNING" | "SUCCEEDED" | "FAILED"; snapshotAt?: Date; schemaVersion?: string; verifiedAt?: Date; errorCode?: string };
export type RestoreProviderStatus = { status: "RUNNING" | "SUCCEEDED" | "FAILED"; errorCode?: string };

export interface BackupProvider {
  health(): Promise<ProviderHealth>;
  listBackups(): Promise<ProviderBackup[]>;
  createSnapshot(input: { backupType: string; reason: string; idempotencyKey: string }): Promise<ProviderBackup>;
  getBackup(providerBackupId: string): Promise<ProviderBackup | null>;
  previewRestore(providerBackupId: string): Promise<{ ready: boolean; detail?: string }>;
  startRestore(providerBackupId: string, idempotencyKey: string): Promise<{ operationId: string }>;
  getRestoreStatus(operationId: string): Promise<RestoreProviderStatus>;
}

export class UnavailableBackupProvider implements BackupProvider {
  async health(): Promise<ProviderHealth> { return { ready: false, status: "NOT_CONFIGURED", provider: "unavailable", detail: "未配置正式云快照适配器" }; }
  async listBackups(): Promise<ProviderBackup[]> { return []; }
  async createSnapshot(): Promise<never> { throw new Error("BACKUP_PROVIDER_UNAVAILABLE"); }
  async getBackup(): Promise<null> { return null; }
  async previewRestore(): Promise<{ ready: false; detail: string }> { return { ready: false, detail: "未配置正式云快照适配器" }; }
  async startRestore(): Promise<never> { throw new Error("BACKUP_PROVIDER_UNAVAILABLE"); }
  async getRestoreStatus(): Promise<RestoreProviderStatus> { return { status: "FAILED", errorCode: "BACKUP_PROVIDER_UNAVAILABLE" }; }
}

export class FakeBackupProvider implements BackupProvider {
  readonly snapshots: ProviderBackup[] = []; readonly createCalls: string[] = []; readonly restoreCalls: string[] = []; private readonly operations = new Map<string, RestoreProviderStatus>();
  constructor(private readonly options: { failCreate?: boolean; failRestore?: boolean; ready?: boolean } = {}) {}
  async health(): Promise<ProviderHealth> { return this.options.ready === false ? { ready: false, status: "DEGRADED", provider: "fake" } : { ready: true, status: "READY", provider: "fake" }; }
  async listBackups() { return this.snapshots; }
  async createSnapshot(input: { backupType: string; reason: string; idempotencyKey: string }): Promise<ProviderBackup> { this.createCalls.push(input.idempotencyKey); if (this.options.failCreate) throw new Error("FAKE_BACKUP_FAILED"); const item = { providerBackupId: `fake-${createHash("sha256").update(input.idempotencyKey).digest("hex")}`, status: "SUCCEEDED" as const, snapshotAt: new Date(), schemaVersion: "test-schema", verifiedAt: new Date() }; this.snapshots.push(item); return item; }
  async getBackup(id: string) { return this.snapshots.find((item) => item.providerBackupId === id) ?? null; }
  async previewRestore(id: string) { return { ready: this.snapshots.some((item) => item.providerBackupId === id), detail: "TEST fake provider preview" }; }
  async startRestore(id: string, idempotencyKey: string) { this.restoreCalls.push(idempotencyKey); if (this.options.failRestore) throw new Error("FAKE_RESTORE_FAILED"); const operationId = `restore-${id}`; this.operations.set(operationId, { status: "SUCCEEDED" }); return { operationId }; }
  async getRestoreStatus(id: string) { return this.operations.get(id) ?? { status: "FAILED" as const, errorCode: "RESTORE_OPERATION_NOT_FOUND" }; }
}

const runtime = globalThis as typeof globalThis & { __zlbBackupProvider?: BackupProvider };
export function getBackupProvider(): BackupProvider { runtime.__zlbBackupProvider ??= process.env.APP_ENV === "test" || process.env.NODE_ENV === "test" ? new FakeBackupProvider() : new UnavailableBackupProvider(); return runtime.__zlbBackupProvider; }
import { createHash } from "node:crypto";
