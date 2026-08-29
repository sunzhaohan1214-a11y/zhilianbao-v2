import { mkdir, writeFile } from "node:fs/promises";
import { cynosdb } from "tencentcloud-sdk-nodejs-cynosdb";
import { assertRestoreDrillAllowed, RESTORE_DRILL_CONFIRMATION } from "../src/modules/system/restore-drill-guard.ts";

const args = Object.fromEntries(process.argv.slice(2).map((value) => {
  const [key, ...rest] = value.replace(/^--/, "").split("=");
  return [key, rest.join("=") || "true"];
}));
const execute = args.execute === "true";
const startedAt = new Date().toISOString();
const targetPrefix = process.env.CYNOSDB_RESTORE_TARGET_PREFIX ?? "zlb-restore-test-";
const targetName = args["target-name"] ?? `${targetPrefix}${Date.now()}`;
const sourceClusterId = process.env.CYNOSDB_CLUSTER_ID;
const backupId = args["backup-id"];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`RESTORE_DRILL_CONFIG_MISSING_${name}`);
  return value;
}

function safeFailure(error) {
  return error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : "RESTORE_DRILL_PROVIDER_REQUEST_FAILED";
}

async function persist(payload) {
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/restore-drill.json", `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

try {
  assertRestoreDrillAllowed({
    appEnvironment: process.env.APP_ENV,
    enabled: process.env.CYNOSDB_ALLOW_RESTORE_DRILL,
    costAcknowledged: process.env.CYNOSDB_RESTORE_DRILL_COST_ACK,
    confirmation: args.confirm,
    sourceClusterId,
    backupId,
    targetName,
    targetPrefix,
  });
  const region = required("CYNOSDB_REGION");
  const zone = required("CYNOSDB_ZONE");
  const vpcId = required("CYNOSDB_VPC_ID");
  const subnetId = required("CYNOSDB_SUBNET_ID");
  required("TENCENT_CLOUD_SECRET_ID");
  required("TENCENT_CLOUD_SECRET_KEY");

  const plan = {
    status: execute ? "RUNNING" : "BLOCKED_BY_EXTERNAL_ENV",
    code: execute ? "RESTORE_DRILL_SUBMISSION_PENDING" : "DRY_RUN_ONLY_NO_PROVIDER_SIDE_EFFECT",
    startedAt,
    sourceClusterId,
    backupId,
    targetName,
    region,
    zone,
    cleanupRequired: true,
    cleanupAutomatic: false,
    confirmationRequired: RESTORE_DRILL_CONFIRMATION,
  };
  if (!execute) {
    await persist(plan);
    console.log(JSON.stringify(plan));
    process.exit(0);
  }

  const client = new cynosdb.v20190107.Client({
    credential: { secretId: process.env.TENCENT_CLOUD_SECRET_ID, secretKey: process.env.TENCENT_CLOUD_SECRET_KEY },
    region,
    profile: { httpProfile: { reqTimeout: Math.ceil(Number(process.env.CYNOSDB_TIMEOUT_MS ?? 15_000) / 1_000) } },
  });
  const cluster = (await client.DescribeClusterDetail({ ClusterId: sourceClusterId })).Detail;
  if (cluster?.ClusterId !== sourceClusterId || cluster.Region !== region || cluster.Status !== "running") throw new Error("RESTORE_DRILL_SOURCE_CLUSTER_NOT_READY");
  if (cluster.Zone !== zone || cluster.VpcId !== vpcId || cluster.SubnetId !== subnetId) throw new Error("RESTORE_DRILL_NETWORK_IDENTITY_MISMATCH");
  const backups = await client.DescribeBackupList({ ClusterId: sourceClusterId, BackupIds: [BigInt(backupId)], Limit: 100, Offset: 0 });
  const exact = (backups.BackupList ?? []).filter((item) => String(item.BackupId) === backupId && item.BackupStatus === "success");
  if (exact.length !== 1) throw new Error("RESTORE_DRILL_BACKUP_NOT_UNIQUE_SUCCEEDED");

  const response = await client.RollbackToNewCluster({
    Zone: zone,
    OriginalClusterId: sourceClusterId,
    UniqVpcId: vpcId,
    UniqSubnetId: subnetId,
    ClusterName: targetName,
    RollbackId: Number(backupId),
    ExpectTime: exact[0].SnapshotTime,
    DealMode: 0,
    PayMode: 0,
    AutoVoucher: 0,
  });
  const result = {
    ...plan,
    status: "BLOCKED_BY_EXTERNAL_ENV",
    code: "RESTORE_CLUSTER_SUBMITTED_VALIDATION_AND_MANUAL_CLEANUP_REQUIRED",
    submittedAt: new Date().toISOString(),
    clusterIds: response.ClusterIds ?? [],
    dealNames: response.DealNames ?? [],
    validation: { schemaVersion: "NOT_RUN", rowCounts: "NOT_RUN", keyQueries: "NOT_RUN", attachmentMetadata: "NOT_RUN", latestBackup: "NOT_RUN" },
  };
  await persist(result);
  console.log(JSON.stringify(result));
} catch (error) {
  const result = { status: "FAIL", code: safeFailure(error), startedAt, finishedAt: new Date().toISOString(), cleanupAutomatic: false };
  await persist(result);
  console.error(JSON.stringify(result));
  process.exit(1);
}
