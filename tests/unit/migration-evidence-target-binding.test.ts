import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MIGRATION_EVIDENCE_MODULES } from "@/modules/hardening/release-readiness-core";
import { validateMigrationTargetStateBinding } from "@/modules/hardening/migration-evidence-target-binding";

type ModuleRow = {
  module: string;
  sourceCount: number;
  successCount: number;
  failedCount: number;
  skippedCount: number;
  mergedCount: number;
  reviewCount: number;
  attachmentCount: number;
  attachmentSuccessCount: number;
  attachmentIssueCount: number;
};

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(object).sort().map((key) => [key, canonicalValue(object[key])]));
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalValue(value))).digest("hex");
}

function applyModules(): ModuleRow[] {
  return MIGRATION_EVIDENCE_MODULES.map((module) => {
    const sourceCount = module === "ATTACHMENT" ? 3 : 1;
    return {
      module,
      sourceCount,
      successCount: sourceCount,
      failedCount: 0,
      skippedCount: 0,
      mergedCount: 0,
      reviewCount: 0,
      attachmentCount: module === "ATTACHMENT" ? sourceCount : 0,
      attachmentSuccessCount: module === "ATTACHMENT" ? sourceCount : 0,
      attachmentIssueCount: 0,
    };
  });
}

function targetState(modules: ModuleRow[], overrides: Partial<Record<string, unknown>> = {}) {
  const moduleCounts = Object.fromEntries(modules.map((module) => [
    module.module,
    module.module === "ATTACHMENT"
      ? module.attachmentSuccessCount
      : module.successCount + module.mergedCount + module.skippedCount > 0 ? 1 : 0,
  ]));
  const legacyMapCountsByModule = Object.fromEntries(modules
    .filter((module) => module.module !== "ATTACHMENT")
    .map((module) => [module.module, module.successCount + module.mergedCount + module.skippedCount]));
  const legacyMapCount = Object.values(legacyMapCountsByModule).reduce((sum, count) => sum + count, 0);
  const attachmentCount = moduleCounts.ATTACHMENT;
  const base = {
    moduleCounts,
    legacyMapCountsByModule,
    legacyMapCount,
    danglingLegacyMapCount: 0,
    recordCount: Object.values(moduleCounts).reduce((sum, count) => sum + count, 0),
    attachmentCount,
  };
  const state = { ...base, ...overrides } as Record<string, unknown>;
  state.sha256 = digest({
    moduleCounts: state.moduleCounts,
    legacyMapCountsByModule: state.legacyMapCountsByModule,
    legacyMapCount: state.legacyMapCount,
    danglingLegacyMapCount: state.danglingLegacyMapCount,
    attachmentCount: state.attachmentCount,
  });
  return state;
}

describe("migration target-state binding", () => {
  it("accepts database-derived target and LegacyMigrationMap counts bound to APPLY results", () => {
    const modules = applyModules();
    expect(validateMigrationTargetStateBinding(modules, targetState(modules))).toBe(true);
  });

  it("rejects zero target/map counts when APPLY reports successful non-attachment rows", () => {
    const modules = applyModules();
    const state = targetState(modules);
    const moduleCounts = { ...(state.moduleCounts as Record<string, number>) };
    const legacyMapCountsByModule = { ...(state.legacyMapCountsByModule as Record<string, number>) };
    for (const module of MIGRATION_EVIDENCE_MODULES) {
      if (module !== "ATTACHMENT") moduleCounts[module] = 0;
    }
    for (const module of Object.keys(legacyMapCountsByModule)) legacyMapCountsByModule[module] = 0;
    expect(validateMigrationTargetStateBinding(modules, targetState(modules, {
      moduleCounts,
      legacyMapCountsByModule,
      legacyMapCount: 0,
      recordCount: moduleCounts.ATTACHMENT,
    }))).toBe(false);
  });

  it("rejects a LegacyMigrationMap total that is not reconciled per source module", () => {
    const modules = applyModules();
    const state = targetState(modules);
    const legacyMapCountsByModule = { ...(state.legacyMapCountsByModule as Record<string, number>) };
    legacyMapCountsByModule.ORGANIZATION = 0;
    expect(validateMigrationTargetStateBinding(modules, targetState(modules, {
      legacyMapCountsByModule,
      legacyMapCount: Number(state.legacyMapCount) - 1,
    }))).toBe(false);
  });

  it("allows many source mappings to one distinct linked target while preserving map counts", () => {
    const modules = applyModules();
    const organization = modules.find((module) => module.module === "ORGANIZATION")!;
    organization.sourceCount = 2;
    organization.successCount = 0;
    organization.mergedCount = 2;
    const state = targetState(modules);
    expect((state.moduleCounts as Record<string, number>).ORGANIZATION).toBe(1);
    expect((state.legacyMapCountsByModule as Record<string, number>).ORGANIZATION).toBe(2);
    expect(validateMigrationTargetStateBinding(modules, state)).toBe(true);
  });

  it("rejects dangling map evidence and a self-reported target-state digest", () => {
    const modules = applyModules();
    expect(validateMigrationTargetStateBinding(modules, targetState(modules, { danglingLegacyMapCount: 1 }))).toBe(false);
    const state = targetState(modules);
    state.sha256 = "0".repeat(64);
    expect(validateMigrationTargetStateBinding(modules, state)).toBe(false);
  });
});
