export const RESTORE_DRILL_CONFIRMATION = "RESTORE-TO-NEW-TEST-CLUSTER";

export type RestoreDrillGuardInput = {
  appEnvironment?: string;
  enabled?: string;
  costAcknowledged?: string;
  confirmation?: string;
  sourceClusterId?: string;
  region?: string;
  vpcId?: string;
  subnetId?: string;
  approvedEnvironment?: string;
  approvedClusterId?: string;
  approvedRegion?: string;
  approvedVpcId?: string;
  approvedSubnetId?: string;
  backupId?: string;
  targetName?: string;
  targetPrefix?: string;
};

export function assertRestoreDrillAllowed(input: RestoreDrillGuardInput): void {
  const environment = input.appEnvironment?.trim().toLowerCase();
  if (environment === "prod" || environment === "production") throw new Error("RESTORE_DRILL_PROD_FORBIDDEN");
  if (environment !== "test") throw new Error("RESTORE_DRILL_TEST_ENV_REQUIRED");
  if (input.approvedEnvironment?.trim().toLowerCase() !== "test") throw new Error("RESTORE_DRILL_APPROVED_TEST_IDENTITY_REQUIRED");
  if (!input.approvedClusterId || input.sourceClusterId !== input.approvedClusterId
    || !input.approvedRegion || input.region !== input.approvedRegion
    || !input.approvedVpcId || input.vpcId !== input.approvedVpcId
    || !input.approvedSubnetId || input.subnetId !== input.approvedSubnetId) throw new Error("RESTORE_DRILL_APPROVED_IDENTITY_MISMATCH");
  if (input.enabled !== "true") throw new Error("RESTORE_DRILL_EXPLICIT_ENABLE_REQUIRED");
  if (input.costAcknowledged !== "true") throw new Error("RESTORE_DRILL_COST_ACK_REQUIRED");
  if (input.confirmation !== RESTORE_DRILL_CONFIRMATION) throw new Error("RESTORE_DRILL_CONFIRMATION_INVALID");
  if (!/^cynosdbmysql-[a-z0-9-]+$/i.test(input.sourceClusterId ?? "")) throw new Error("RESTORE_DRILL_SOURCE_CLUSTER_INVALID");
  if (!/^\d+$/.test(input.backupId ?? "") || Number(input.backupId) <= 0) throw new Error("RESTORE_DRILL_BACKUP_ID_INVALID");
  const prefix = input.targetPrefix?.trim();
  if (!prefix || !input.targetName?.startsWith(prefix)) throw new Error("RESTORE_DRILL_TARGET_PREFIX_MISMATCH");
  if (!/^[A-Za-z0-9_.-]{1,63}$/.test(input.targetName ?? "")) throw new Error("RESTORE_DRILL_TARGET_NAME_INVALID");
}
