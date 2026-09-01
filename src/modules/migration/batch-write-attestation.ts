import type { PrismaClient } from "@/generated/prisma/client";

export const MIGRATION_ACTION_NAMES = ["CREATE", "LINK", "UPDATE", "SKIP", "REVIEW", "FAILED"] as const;
export type MigrationActionName = typeof MIGRATION_ACTION_NAMES[number];
export type MigrationActionCounts = Record<MigrationActionName, number>;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export async function collectMigrationBatchWriteAttestation(input: {
  prisma: PrismaClient;
  batchId: string;
}): Promise<{ actionCounts: MigrationActionCounts; sourceActionCount: number }> {
  const batch = await input.prisma.migrationBatch.findUnique({
    where: { id: input.batchId },
    select: { status: true, mode: true, reconciliationJson: true },
  });
  if (!batch || batch.status !== "SUCCEEDED" || batch.mode !== "FULL_REHEARSAL") {
    throw new Error("MIGRATION_WRITE_ATTESTATION_BATCH_INVALID");
  }

  const reconciliation = objectValue(batch.reconciliationJson);
  const rawCounts = objectValue(reconciliation?.actionCounts);
  if (reconciliation?.phase !== "ACTUAL_APPLY" || !rawCounts
    || Object.keys(rawCounts).length !== MIGRATION_ACTION_NAMES.length
    || !MIGRATION_ACTION_NAMES.every((action) => Object.prototype.hasOwnProperty.call(rawCounts, action))) {
    throw new Error("MIGRATION_WRITE_ATTESTATION_COUNTS_MISSING");
  }

  const actionCounts = Object.fromEntries(MIGRATION_ACTION_NAMES.map((action) => {
    const value = rawCounts[action];
    if (!nonNegativeInteger(value)) throw new Error("MIGRATION_WRITE_ATTESTATION_COUNTS_INVALID");
    return [action, value];
  })) as MigrationActionCounts;
  if (actionCounts.REVIEW !== 0 || actionCounts.FAILED !== 0) {
    throw new Error("MIGRATION_WRITE_ATTESTATION_UNRESOLVED_ACTION");
  }

  const moduleRows = await input.prisma.migrationModuleResult.findMany({
    where: { batchId: input.batchId },
    select: { sourceCount: true },
  });
  const sourceActionCount = moduleRows.reduce((sum, row) => sum + row.sourceCount, 0);
  const persistedActionCount = MIGRATION_ACTION_NAMES.reduce((sum, action) => sum + actionCounts[action], 0);
  if (persistedActionCount !== sourceActionCount) {
    throw new Error("MIGRATION_WRITE_ATTESTATION_TOTAL_MISMATCH");
  }

  return { actionCounts, sourceActionCount };
}
