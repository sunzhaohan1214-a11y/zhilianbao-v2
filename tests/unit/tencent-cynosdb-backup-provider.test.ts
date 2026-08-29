import { describe, expect, it, vi } from "vitest";
import { TencentCynosDbBackupProvider, type CynosDbClient, type TencentCynosDbConfig } from "@/modules/system/tencent-cynosdb-backup-provider";

const config: TencentCynosDbConfig = {
  secretId: "test-secret-id", secretKey: "test-secret-key", region: "ap-shanghai",
  clusterId: "cynosdbmysql-test", environment: "test", timeoutMs: 1_000,
};

function client(overrides: Partial<CynosDbClient> = {}): CynosDbClient {
  return {
    DescribeClusterDetail: vi.fn().mockResolvedValue({ Detail: { ClusterId: config.clusterId, Region: config.region, Status: "running" } }),
    DescribeBackupList: vi.fn().mockResolvedValue({ TotalCount: 0, BackupList: [] }),
    CreateBackup: vi.fn().mockResolvedValue({ FlowId: 12 }),
    ...overrides,
  };
}

describe("TencentCynosDbBackupProvider", () => {
  it("only reports backup ready for the configured running cluster and keeps web restore disabled", async () => {
    const provider = new TencentCynosDbBackupProvider(config, client());
    await expect(provider.health()).resolves.toMatchObject({ ready: true, backupReady: true, restoreReady: false, provider: "tencent-cynosdb" });
  });

  it("degrades without leaking SDK errors", async () => {
    const provider = new TencentCynosDbBackupProvider(config, client({ DescribeClusterDetail: vi.fn().mockRejectedValue(new Error("secret endpoint")) }));
    await expect(provider.health()).resolves.toEqual(expect.objectContaining({ ready: false, status: "DEGRADED", detail: "CynosDB health request failed" }));
  });

  it("paginates and maps provider backup metadata", async () => {
    const describe = vi.fn()
      .mockResolvedValueOnce({ TotalCount: 101, BackupList: Array.from({ length: 100 }, (_, index) => ({ BackupId: index + 1, BackupStatus: "success", BackupMethod: "auto", SnapShotType: "full", SnapshotTime: "2026-08-29T00:00:00Z" })) })
      .mockResolvedValueOnce({ TotalCount: 101, BackupList: [{ BackupId: 101, BackupStatus: "creating", BackupMethod: "manual" }] });
    const provider = new TencentCynosDbBackupProvider(config, client({ DescribeBackupList: describe }));
    const items = await provider.listBackups();
    expect(items).toHaveLength(101);
    expect(items[0]).toMatchObject({ providerBackupId: "1", backupType: "AUTO_FULL", status: "SUCCEEDED", sourceEnvironment: "TEST" });
    expect(items[100]).toMatchObject({ providerBackupId: "101", backupType: "MANUAL", status: "RUNNING" });
  });

  it("reconciles a deterministic name before creating a duplicate", async () => {
    const describe = vi.fn().mockResolvedValue({ TotalCount: 1, BackupList: [{ BackupId: 77, BackupName: "zlb-test-row-1", BackupStatus: "success", BackupMethod: "manual" }] });
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
    const duplicate = { BackupId: 1, BackupName: "zlb-test-row-3", BackupStatus: "success" };
    const provider = new TencentCynosDbBackupProvider(config, client({ DescribeBackupList: vi.fn().mockResolvedValue({ TotalCount: 2, BackupList: [duplicate, { ...duplicate, BackupId: 2 }] }) }));
    await expect(provider.createSnapshot({ backupType: "MANUAL", reason: "test", idempotencyKey: "row-3" })).rejects.toThrow("BACKUP_PROVIDER_AMBIGUOUS");
  });
});
