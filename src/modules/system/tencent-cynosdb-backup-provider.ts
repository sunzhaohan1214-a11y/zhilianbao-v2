import { cynosdb } from "tencentcloud-sdk-nodejs-cynosdb";
import type { BackupType } from "@/generated/prisma/client";
import type { BackupProvider, ProviderBackup, ProviderHealth, RestoreProviderStatus } from "./backup-provider";
import { CURRENT_SCHEMA_VERSION, currentAppVersion } from "./runtime";

type BackupFile = {
  BackupId?: number;
  BackupName?: string;
  BackupType?: string;
  BackupMethod?: string;
  BackupStatus?: string;
  SnapshotTime?: string;
  StartTime?: string;
  FinishTime?: string;
  SnapShotType?: string;
};

export type CynosDbClient = {
  DescribeClusterDetail(input: { ClusterId: string }): Promise<{ Detail?: { ClusterId?: string; Region?: string; Status?: string } }>;
  DescribeBackupList(input: {
    ClusterId: string; Limit?: number; Offset?: number; BackupIds?: Array<number | bigint>; BackupNames?: string[];
  }): Promise<{ TotalCount?: number; BackupList?: BackupFile[] }>;
  CreateBackup(input: { ClusterId: string; BackupType: string; BackupName: string }): Promise<{ FlowId?: number }>;
};

export type TencentCynosDbConfig = {
  secretId: string; secretKey: string; region: string; clusterId: string; environment: string; timeoutMs: number;
};

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`BACKUP_PROVIDER_CONFIG_MISSING_${name}`);
  return value;
}

function safeEnvironment(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 16) || "unknown";
}

function providerStatus(value: string | undefined): ProviderBackup["status"] {
  if (value === "success") return "SUCCEEDED";
  if (value === "fail" || value === "deleting") return "FAILED";
  return "RUNNING";
}

function mappedBackupType(file: BackupFile): BackupType {
  if (file.BackupMethod === "auto" && file.SnapShotType === "increment") return "AUTO_INCREMENTAL";
  if (file.BackupMethod === "auto") return "AUTO_FULL";
  return "MANUAL";
}

function snapshotAt(file: BackupFile): Date {
  const candidate = file.SnapshotTime ?? file.FinishTime ?? file.StartTime;
  const parsed = candidate ? new Date(candidate) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export class TencentCynosDbBackupProvider implements BackupProvider {
  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): TencentCynosDbBackupProvider {
    const config: TencentCynosDbConfig = {
      secretId: required(environment, "TENCENT_CLOUD_SECRET_ID"),
      secretKey: required(environment, "TENCENT_CLOUD_SECRET_KEY"),
      region: required(environment, "CYNOSDB_REGION"),
      clusterId: required(environment, "CYNOSDB_CLUSTER_ID"),
      environment: safeEnvironment(environment.APP_ENV ?? environment.NODE_ENV ?? "unknown"),
      timeoutMs: Math.max(1_000, Number(environment.CYNOSDB_TIMEOUT_MS ?? 15_000)),
    };
    const client = new cynosdb.v20190107.Client({
      credential: { secretId: config.secretId, secretKey: config.secretKey },
      region: config.region,
      profile: { httpProfile: { reqTimeout: Math.ceil(config.timeoutMs / 1_000) } },
    });
    return new TencentCynosDbBackupProvider(config, client);
  }

  constructor(private readonly config: TencentCynosDbConfig, private readonly client: CynosDbClient) {}

  private deterministicName(idempotencyKey: string): string {
    const safeKey = idempotencyKey.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 36);
    return `zlb-${safeEnvironment(this.config.environment)}-${safeKey}`.slice(0, 60);
  }

  private map(file: BackupFile): ProviderBackup {
    if (file.BackupId === undefined) throw new Error("BACKUP_PROVIDER_MISSING_BACKUP_ID");
    const when = snapshotAt(file);
    return {
      providerBackupId: String(file.BackupId),
      backupType: mappedBackupType(file),
      sourceEnvironment: this.config.environment.toUpperCase(),
      status: providerStatus(file.BackupStatus),
      snapshotAt: when,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      appVersion: currentAppVersion(),
      verifiedAt: file.BackupStatus === "success" ? when : undefined,
      errorCode: file.BackupStatus === "fail" ? "CYNOSDB_BACKUP_FAILED" : undefined,
    };
  }

  async health(): Promise<ProviderHealth> {
    try {
      const response = await this.client.DescribeClusterDetail({ ClusterId: this.config.clusterId });
      const detail = response.Detail;
      const ready = detail?.ClusterId === this.config.clusterId && detail.Region === this.config.region && detail.Status === "running";
      return {
        ready, backupReady: ready, restoreReady: false, status: ready ? "READY" : "DEGRADED", provider: "tencent-cynosdb",
        detail: ready ? "CynosDB cluster is running; web restore remains disabled" : "CynosDB cluster identity, region, or status check failed",
      };
    } catch {
      return { ready: false, backupReady: false, restoreReady: false, status: "DEGRADED", provider: "tencent-cynosdb", detail: "CynosDB health request failed" };
    }
  }

  async listBackups(): Promise<ProviderBackup[]> {
    const result: ProviderBackup[] = [];
    for (let offset = 0; ; offset += 100) {
      const response = await this.client.DescribeBackupList({ ClusterId: this.config.clusterId, Limit: 100, Offset: offset });
      for (const item of response.BackupList ?? []) result.push(this.map(item));
      if (offset + 100 >= (response.TotalCount ?? 0) || !(response.BackupList?.length)) break;
    }
    return result;
  }

  private async findByName(name: string): Promise<ProviderBackup | null> {
    const response = await this.client.DescribeBackupList({ ClusterId: this.config.clusterId, Limit: 100, Offset: 0, BackupNames: [name] });
    const exact = (response.BackupList ?? []).filter((item) => item.BackupName === name);
    if (exact.length > 1) throw new Error("BACKUP_PROVIDER_AMBIGUOUS");
    return exact[0] ? this.map(exact[0]) : null;
  }

  async createSnapshot(input: { backupType: BackupType; reason: string; idempotencyKey: string }): Promise<ProviderBackup> {
    const name = this.deterministicName(input.idempotencyKey);
    const existing = await this.findByName(name);
    if (existing) return existing;
    const created = await this.client.CreateBackup({ ClusterId: this.config.clusterId, BackupType: "snapshot", BackupName: name });
    const visible = await this.findByName(name);
    if (visible) return visible;
    if (created.FlowId === undefined) throw new Error("BACKUP_PROVIDER_MISSING_FLOW_ID");
    return {
      providerBackupId: `pending-${name}`, backupType: input.backupType,
      sourceEnvironment: this.config.environment.toUpperCase(), status: "RUNNING", snapshotAt: new Date(),
      schemaVersion: CURRENT_SCHEMA_VERSION, appVersion: currentAppVersion(),
    };
  }

  async getBackup(providerBackupId: string): Promise<ProviderBackup | null> {
    if (providerBackupId.startsWith("pending-")) return this.findByName(providerBackupId.slice("pending-".length));
    if (!/^\d+$/.test(providerBackupId)) return null;
    const response = await this.client.DescribeBackupList({ ClusterId: this.config.clusterId, Limit: 100, Offset: 0, BackupIds: [BigInt(providerBackupId)] });
    const exact = (response.BackupList ?? []).filter((item) => String(item.BackupId) === providerBackupId);
    if (exact.length > 1) throw new Error("BACKUP_PROVIDER_AMBIGUOUS");
    return exact[0] ? this.map(exact[0]) : null;
  }

  async previewRestore(providerBackupId: string): Promise<{ ready: boolean; detail?: string }> {
    const backup = await this.getBackup(providerBackupId);
    return { ready: false, detail: backup ? "Web-triggered restore is disabled; use the guarded restore drill" : "Backup does not exist" };
  }

  async startRestore(): Promise<never> { throw new Error("RESTORE_PROVIDER_DISABLED"); }
  async getRestoreStatus(): Promise<RestoreProviderStatus> { return { status: "FAILED", errorCode: "RESTORE_PROVIDER_DISABLED" }; }
}
