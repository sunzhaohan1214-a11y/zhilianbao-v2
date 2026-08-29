import { describe, expect, it, vi } from "vitest";
import { TencentCynosDbBackupProvider, type CynosDbClient, type TencentCynosDbConfig } from "@/modules/system/tencent-cynosdb-backup-provider";

const config: TencentCynosDbConfig = {
  secretId: "test-secret-id", secretKey: "test-secret-key", region: "ap-shanghai",
  clusterId: "cynosdbmysql-test", environment: "test", timeoutMs: 1_000,
  approvedEnvironment: "test", approvedClusterId: "cynosdbmysql-test", approvedRegion: "ap-shanghai",
  approvedVpcId: "vpc-test", approvedSubnetId: "subnet-test",
};

function client(overrides: Partial<CynosDbClient> = {}): CynosDbClient {
  return {
    DescribeClusterDetail: vi.fn().mockResolvedValue({ Detail: { ClusterId: config.clusterId, Region: config.region, Status: "running", VpcId: config.approvedVpcId, SubnetId: config.approvedSubnetId } }),
    DescribeBackupList: vi.fn().mockResolvedValue({ TotalCount: 0, BackupList: [] }),
    CreateBackup: vi.fn().mockResolvedValue({ FlowId: 12 }),
    ...overrides,
  };
}

describe("TencentCynosDbBackupProvider", () => {
  it("requires deployment-approved identity inputs instead of trusting APP_ENV", () => {
    expect(() => TencentCynosDbBackupProvider.fromEnvironment({ NODE_ENV: "test", APP_ENV: "test", TENCENT_CLOUD_SECRET_ID: "id", TENCENT_CLOUD_SECRET_KEY: "key", CYNOSDB_REGION: "ap-shanghai", CYNOSDB_CLUSTER_ID: "cynosdbmysql-test" })).toThrow("BACKUP_PROVIDER_CONFIG_MISSING_CYNOSDB_APPROVED_ENVIRONMENT");
  });

  it("only reports backup ready for the configured running cluster and keeps web restore disabled", async () => {
    const provider = new TencentCynosDbBackupProvider(config, client());
    await expect(provider.health()).resolves.toMatchObject({ ready: true, backupReady: true, restoreReady: false, provider: "tencent-cynosdb" });
  });

  it("degrades without leaking SDK errors", async () => {
    const provider = new TencentCynosDbBackupProvider(config, client({ DescribeClusterDetail: vi.fn().mockRejectedValue(new Error("secret endpoint")) }));
    await expect(provider.health()).resolves.toEqual(expect.objectContaining({ ready: false, status: "DEGRADED", detail: "CynosDB health request failed" }));
  });

  it("fails closed when APP_ENV or provider-returned network identity is not approved", async () => {
    const wrongEnvironment = new TencentCynosDbBackupProvider({ ...config, environment: "prod" }, client());
    await expect(wrongEnvironment.health()).resolves.toMatchObject({ ready: false, status: "DEGRADED" });
    await expect(wrongEnvironment.createSnapshot({ backupType: "MANUAL", reason: "test", idempotencyKey: "wrong-env" })).rejects.toThrow("CYNOSDB_APPROVED_IDENTITY_CONFIG_MISMATCH");
    const prodNetwork = new TencentCynosDbBackupProvider(config, client({ DescribeClusterDetail: vi.fn().mockResolvedValue({ Detail: { ClusterId: config.clusterId, Region: config.region, Status: "running", VpcId: "vpc-prod", SubnetId: "subnet-prod" } }) }));
    await expect(prodNetwork.listBackups()).rejects.toThrow("CYNOSDB_APPROVED_IDENTITY_NOT_VERIFIED");
  });

  it("paginates and maps provider backup metadata", async () => {
    const describe = vi.fn()
      .mockResolvedValueOnce({ TotalCount: 101, BackupList: Array.from({ length: 100 }, (_, index) => ({ BackupId: index + 1, BackupName: `backup-${index + 1}`, BackupStatus: "success", BackupMethod: "auto", SnapShotType: "full", SnapshotTime: "2026-08-29T00:00:00Z" })) })
      .mockResolvedValueOnce({ TotalCount: 101, BackupList: [{ BackupId: 101, BackupName: "backup-101", BackupStatus: "creating", BackupMethod: "manual", StartTime: "2026-08-29T00:01:00Z" }] });
    const provider = new TencentCynosDbBackupProvider(config, client({ DescribeBackupList: describe }));
    const items = await provider.listBackups();
    expect(items).toHaveLength(101);
    expect(items[0]).toMatchObject({ providerBackupId: "1", correlationId: "backup-1", backupType: "AUTO_FULL", status: "SUCCEEDED", sourceEnvironment: "TEST" });
    expect(items[0]).not.toHaveProperty("schemaVersion");
    expect(items[0]).not.toHaveProperty("appVersion");
    expect(items[0]).not.toHaveProperty("verifiedAt");
    expect(items[100]).toMatchObject({ providerBackupId: "101", backupType: "MANUAL", status: "RUNNING" });
  });

  it("deduplicates repeated pagination rows and fails closed for one name mapped to two IDs", async () => {
    const repeated = { BackupId: 1, BackupName: "stable-name", BackupStatus: "success", SnapshotTime: "2026-08-29T00:00:00Z" };
    const deduplicating = new TencentCynosDbBackupProvider(config, client({ DescribeBackupList: vi.fn().mockResolvedValue({ TotalCount: 2, BackupList: [repeated, repeated] }) }));
    await expect(deduplicating.listBackups()).resolves.toHaveLength(1);
    const ambiguous = new TencentCynosDbBackupProvider(config, client({ DescribeBackupList: vi.fn().mockResolvedValue({ TotalCount: 2, BackupList: [repeated, { ...repeated, BackupId: 2 }] }) }));
    await expect(ambiguous.listBackups()).rejects.toThrow("BACKUP_PROVIDER_AMBIGUOUS");
  });

  it("fails closed when a provider catalog item has no usable snapshot time", async () => {
    const missing = new TencentCynosDbBackupProvider(config, client({ DescribeBackupList: vi.fn().mockResolvedValue({ TotalCount: 1, BackupList: [{ BackupId: 1, BackupStatus: "success" }] }) }));
    await expect(missing.listBackups()).rejects.toThrow("BACKUP_PROVIDER_SNAPSHOT_TIME_MISSING");

    const invalid = new TencentCynosDbBackupProvider(config, client({ DescribeBackupList: vi.fn().mockResolvedValue({ TotalCount: 1, BackupList: [{ BackupId: 2, BackupStatus: "success", SnapshotTime: "not-a-time" }] }) }));
    await expect(invalid.listBackups()).rejects.toThrow("BACKUP_PROVIDER_SNAPSHOT_TIME_INVALID");
  });

  it("reconciles a deterministic name before creating a duplicate", async () => {
    const describe = vi.fn().mockResolvedValue({ TotalCount: 1, BackupList: [{ BackupId: 77, BackupName: "zlb-test-row-1", BackupStatus: "success", BackupMethod: "manual", SnapshotTime: "2026-08-29T00:00:00Z" }] });
    const create = vi.fn();
    const provider = new TencentCynosDbBackupProvider(config, client({ DescribeBackupList: describe, CreateBackup: create }));
    await expect(provider.createSnapshot({ backupType: "MANUAL", reason: "test", idempotencyKey: "row-1" })).resolves.toMatchObject({ providerBackupId: "77" });
    expect(create).not.toHaveBeenCalled();
  });

  it("returns a stable pending reference when a successful create is not catalog-visible yet", async () => {
    const providerClient = client();
    const provider = new TencentCynosDbBackupProvider(config, providerClient);
    await expect(provider.createSnapshot({ backupType: "PRE_RELEASE", reason: "release", idempotencyKey: "row-2" })).resolves.toMatchObject({ providerBackupId: "pending-zlb-test-row-2", status: "RUNNING" });
    expect(providerClient.CreateBackup).toHaveBeenCalledWith({ ClusterId: config.clusterId, BackupType: "snapshot", BackupName: "zlb-test-row-2" });
  });

  it("fails closed when provider name reconciliation is ambiguous", async () => {
    const duplicate = { BackupId: 1, BackupName: "zlb-test-row-3", BackupStatus: "success", SnapshotTime: "2026-08-29T00:00:00Z" };
    const provider = new TencentCynosDbBackupProvider(config, client({ DescribeBackupList: vi.fn().mockResolvedValue({ TotalCount: 2, BackupList: [duplicate, { ...duplicate, BackupId: 2 }] }) }));
    await expect(provider.createSnapshot({ backupType: "MANUAL", reason: "test", idempotencyKey: "row-3" })).rejects.toThrow("BACKUP_PROVIDER_AMBIGUOUS");
  });
});
