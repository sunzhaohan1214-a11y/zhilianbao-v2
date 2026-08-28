import type { LegacyEntityType, MigrationReconciliation, ReconciliationModule } from "./types";

export function emptyModule(module: LegacyEntityType | "ATTACHMENT"): ReconciliationModule {
  return { module, sourceCount: 0, successCount: 0, failedCount: 0, skippedCount: 0, mergedCount: 0, reviewCount: 0, attachmentCount: 0, attachmentSuccessCount: 0, attachmentIssueCount: 0 };
}

export function reconciliationFormulaPass(module: ReconciliationModule): boolean {
  return module.sourceCount === module.successCount + module.failedCount + module.skippedCount + module.mergedCount + module.reviewCount
    && module.attachmentCount === module.attachmentSuccessCount + module.attachmentIssueCount;
}

export function finalizeReconciliation(input: Omit<MigrationReconciliation, "totals" | "formulaPass" | "unresolvedBlockerCount"> & { unresolvedBlockerCount: number }): MigrationReconciliation {
  const totals = input.modules.reduce<Omit<ReconciliationModule, "module">>((sum, value) => ({
    sourceCount: sum.sourceCount + value.sourceCount, successCount: sum.successCount + value.successCount, failedCount: sum.failedCount + value.failedCount,
    skippedCount: sum.skippedCount + value.skippedCount, mergedCount: sum.mergedCount + value.mergedCount, reviewCount: sum.reviewCount + value.reviewCount,
    attachmentCount: sum.attachmentCount + value.attachmentCount, attachmentSuccessCount: sum.attachmentSuccessCount + value.attachmentSuccessCount,
    attachmentIssueCount: sum.attachmentIssueCount + value.attachmentIssueCount,
  }), { sourceCount: 0, successCount: 0, failedCount: 0, skippedCount: 0, mergedCount: 0, reviewCount: 0, attachmentCount: 0, attachmentSuccessCount: 0, attachmentIssueCount: 0 });
  return { ...input, totals, formulaPass: input.modules.every(reconciliationFormulaPass) };
}
