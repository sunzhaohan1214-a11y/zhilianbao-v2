const MIGRATION_ACTION_NAMES = ["CREATE", "LINK", "UPDATE", "SKIP", "REVIEW", "FAILED"] as const;

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function assertIdempotentMigrationRerunAttestation(value: unknown): void {
  const evidence = objectValue(value);
  const counts = objectValue(evidence?.actionCounts);
  const sourceActionCount = evidence?.sourceActionCount;
  if (!evidence || !counts || !nonNegativeInteger(sourceActionCount)
    || Object.keys(counts).length !== MIGRATION_ACTION_NAMES.length
    || !MIGRATION_ACTION_NAMES.every((action) => nonNegativeInteger(counts[action]))) {
    throw new Error("MIGRATION_RERUN_WRITE_ATTESTATION_INVALID");
  }
  const total = MIGRATION_ACTION_NAMES.reduce((sum, action) => sum + (counts[action] as number), 0);
  if (total !== sourceActionCount || counts.CREATE !== 0 || counts.LINK !== 0 || counts.UPDATE !== 0
    || counts.REVIEW !== 0 || counts.FAILED !== 0 || counts.SKIP !== sourceActionCount) {
    throw new Error("MIGRATION_RERUN_WRITE_ATTESTATION_INVALID");
  }
}
