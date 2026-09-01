import type { PrismaClient } from "@/generated/prisma/client";
import { describe, expect, it } from "vitest";
import {
  collectMigrationTargetStateEvidence,
  MIGRATION_TARGET_STATE_MODULES,
} from "@/modules/migration/target-state-evidence";

const candidateSha = "a".repeat(40);
const manifestSha256 = "b".repeat(64);
const databaseName = "v2-migration-rehearsal-20260901";
const targetSha256 = "c".repeat(64);

function moduleRows() {
  return MIGRATION_TARGET_STATE_MODULES.map((module) => {
    if (module === "ORGANIZATION") {
      return { module, sourceCount: 2, successCount: 1, failedCount: 0, skippedCount: 1, mergedCount: 0, reviewCount: 0, attachmentCount: 0, attachmentSuccessCount: 0, attachmentIssueCount: 0 };
    }
    if (module === "ATTACHMENT") {
      return { module, sourceCount: 1, successCount: 1, failedCount: 0, skippedCount: 0, mergedCount: 0, reviewCount: 0, attachmentCount: 1, attachmentSuccessCount: 1, attachmentIssueCount: 0 };
    }
    return { module, sourceCount: 0, successCount: 0, failedCount: 0, skippedCount: 0, mergedCount: 0, reviewCount: 0, attachmentCount: 0, attachmentSuccessCount: 0, attachmentIssueCount: 0 };
  });
}

function fakePrisma(options: { actualDatabase?: string; includeOrganizationTarget?: boolean } = {}): PrismaClient {
  const actualDatabase = options.actualDatabase ?? databaseName;
  const includeOrganizationTarget = options.includeOrganizationTarget ?? true;
  const emptyDelegate = { findMany: async () => [] };
  return {
    $queryRaw: async () => [{ databaseName: actualDatabase }],
    migrationBatch: {
      findUnique: async () => ({
        id: "apply-batch",
        sourceSystem: "ZHILIANBAO_V1",
        snapshotId: "full-snapshot",
        sourceManifestSha256: manifestSha256,
        codeVersion: candidateSha,
        status: "SUCCEEDED",
        mode: "FULL_REHEARSAL",
      }),
    },
    migrationModuleResult: { findMany: async () => moduleRows() },
    legacyMigrationMap: {
      findMany: async () => [
        { sourceEntity: "ORGANIZATION", sourceId: "org-1", targetEntity: "ORGANIZATION", targetId: "target-org-1" },
        { sourceEntity: "ATTACHMENT", sourceId: "att-1", targetEntity: "ATTACHMENT", targetId: "target-att-1" },
      ],
    },
    migrationIssue: {
      findMany: async () => [{ sourceEntity: "ORGANIZATION", sourceId: "org-skip-1", message: "已应用 SKIP resolution：approved no-write" }],
    },
    migrationAttachmentResult: {
      findMany: async () => [{ sourceAttachmentKey: "att-1", targetAttachmentId: "target-att-1", targetSha256 }],
    },
    organization: { findMany: async () => includeOrganizationTarget ? [{ id: "target-org-1" }] : [] },
    attachment: { findMany: async () => [{ id: "target-att-1", sha256: targetSha256 }] },
    person: emptyDelegate,
    enterprise: emptyDelegate,
    talent: emptyDelegate,
    policy: emptyDelegate,
    demand: emptyDelegate,
    demandProgress: emptyDelegate,
    presenceReport: emptyDelegate,
    trip: emptyDelegate,
    enterpriseVisit: emptyDelegate,
    reimbursement: emptyDelegate,
    helpRequest: emptyDelegate,
    announcement: emptyDelegate,
    roleAssignment: emptyDelegate,
  } as unknown as PrismaClient;
}

describe("migration target-state database collector", () => {
  it("derives mapped and intentionally unmapped SKIP state from the approved TEST database", async () => {
    const evidence = await collectMigrationTargetStateEvidence({
      prisma: fakePrisma(),
      batchId: "apply-batch",
      candidateSha,
      manifestSha256,
      targetEnvironment: "TEST",
      targetMigrationDatabase: databaseName,
    });
    expect(evidence.targetMigrationDatabase).toBe(databaseName);
    expect(evidence.moduleCounts.ORGANIZATION).toBe(1);
    expect(evidence.legacyMapCountsByModule.ORGANIZATION).toBe(1);
    expect(evidence.unmappedSkipCountsByModule.ORGANIZATION).toBe(1);
    expect(evidence.unmappedSkips).toEqual([{ sourceEntity: "ORGANIZATION", sourceId: "org-skip-1" }]);
    expect(evidence.mappings).toContainEqual({ sourceEntity: "ORGANIZATION", sourceId: "org-1", targetEntity: "ORGANIZATION", targetId: "target-org-1" });
    expect(evidence.attachments).toEqual([{ sourceAttachmentKey: "att-1", targetAttachmentId: "target-att-1", targetSha256 }]);
    expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses a DATABASE_URL connected to a database other than the approved isolated target", async () => {
    await expect(collectMigrationTargetStateEvidence({
      prisma: fakePrisma({ actualDatabase: "daily-shared-test" }),
      batchId: "apply-batch",
      candidateSha,
      manifestSha256,
      targetEnvironment: "TEST",
      targetMigrationDatabase: databaseName,
    })).rejects.toThrow("MIGRATION_TARGET_STATE_DATABASE_MISMATCH");
  });

  it("fails closed when a LegacyMigrationMap points at a missing target row", async () => {
    await expect(collectMigrationTargetStateEvidence({
      prisma: fakePrisma({ includeOrganizationTarget: false }),
      batchId: "apply-batch",
      candidateSha,
      manifestSha256,
      targetEnvironment: "TEST",
      targetMigrationDatabase: databaseName,
    })).rejects.toThrow("MIGRATION_TARGET_STATE_DANGLING_MAP");
  });
});
