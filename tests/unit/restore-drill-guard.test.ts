import { describe, expect, it } from "vitest";
import { assertRestoreDrillAllowed, RESTORE_DRILL_CONFIRMATION } from "@/modules/system/restore-drill-guard";

const valid = {
  appEnvironment: "test", enabled: "true", costAcknowledged: "true", confirmation: RESTORE_DRILL_CONFIRMATION,
  sourceClusterId: "cynosdbmysql-test001", backupId: "123", targetName: "zlb-restore-test-123", targetPrefix: "zlb-restore-test-",
  region: "ap-shanghai", vpcId: "vpc-test", subnetId: "subnet-test", approvedEnvironment: "TEST",
  approvedClusterId: "cynosdbmysql-test001", approvedRegion: "ap-shanghai", approvedVpcId: "vpc-test", approvedSubnetId: "subnet-test",
};

describe("restore drill safety guard", () => {
  it("allows only the fully confirmed TEST new-cluster path", () => expect(() => assertRestoreDrillAllowed(valid)).not.toThrow());
  it("hard refuses production even with every switch", () => expect(() => assertRestoreDrillAllowed({ ...valid, appEnvironment: "prod" })).toThrow("RESTORE_DRILL_PROD_FORBIDDEN"));
  it("refuses a PROD cluster disguised by APP_ENV=test", () => expect(() => assertRestoreDrillAllowed({ ...valid, sourceClusterId: "cynosdbmysql-prod", region: "ap-beijing" })).toThrow("RESTORE_DRILL_APPROVED_IDENTITY_MISMATCH"));
  it("requires an independently approved TEST environment identity", () => expect(() => assertRestoreDrillAllowed({ ...valid, approvedEnvironment: "PROD" })).toThrow("RESTORE_DRILL_APPROVED_TEST_IDENTITY_REQUIRED"));
  it.each([
    ["enable", { enabled: "false" }, "RESTORE_DRILL_EXPLICIT_ENABLE_REQUIRED"],
    ["cost", { costAcknowledged: "false" }, "RESTORE_DRILL_COST_ACK_REQUIRED"],
    ["confirmation", { confirmation: "yes" }, "RESTORE_DRILL_CONFIRMATION_INVALID"],
    ["target", { targetName: "prod-copy" }, "RESTORE_DRILL_TARGET_PREFIX_MISMATCH"],
  ])("fails closed when %s guard is absent", (_label, override, code) => expect(() => assertRestoreDrillAllowed({ ...valid, ...override })).toThrow(code));
});
