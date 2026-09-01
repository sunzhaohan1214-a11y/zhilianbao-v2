import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MIGRATION_EVIDENCE_MODULES } from "@/modules/hardening/release-readiness-core";
import { validateMigrationTargetStateBinding } from "@/modules/hardening/migration-evidence";

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
  return MIGRATION_EVIDENCE_MODULES.map((moduleName) => {
    const sourceCount = moduleName === "ATTACHMENT" ? 3 : 1;
    return {
      module: moduleName,
      sourceCount,
      successCount: sourceCount,
      failedCount: 0,
      skippedCount: 0,
      mergedCount: 0,
      reviewCount: 0,
      attachmentCount: moduleName === "ATTACHMENT" ? sourceCount : 0,
      attachmentSuccessCount: moduleName === "ATTACHMENT" ? sourceCount : 0,
      attachmentIssueCount: 0,
    };
  });
}

function targetState(modules: ModuleRow[], unmappedOverrides: Record<string, number> = {}) {
  const unmappedSkipCountsByModule = Object.fromEntries(modules
    .filter((moduleRow) => moduleRow.module !== "ATTACHMENT")
    .map((moduleRow) => [moduleRow.module, unmappedOverrides[moduleRow.module] ?? 0]));
  const legacyMapCountsByModule = Object.fromEntries(modules
    .filter((moduleRow) => moduleRow.module !== "ATTACHMENT")
    .map((moduleRow) => [
      moduleRow.module,
      moduleRow.successCount + moduleRow.mergedCount + moduleRow.skippedCount - unmappedSkipCountsByModule[moduleRow.module],
    ]));
  const moduleCounts = Object.fromEntries(modules.map((moduleRow) => {
    if (moduleRow.module === "ATTACHMENT") return [moduleRow.module, moduleRow.attachmentSuccessCount];
    const mapped = legacyMapCountsByModule[moduleRow.module];
    return [moduleRow.module, mapped > 0 ? 1 : 0];
  }));
  const legacyMapCount = Object.values(legacyMapCountsByModule).reduce((sum, count) => sum + count, 0);
  const attachmentCount = moduleCounts.ATTACHMENT;
  const base = {
    moduleCounts,
    legacyMapCountsByModule,
    unmappedSkipCountsByModule,
    legacyMapCount,
    danglingLegacyMapCount: 0,
    recordCount: Object.values(moduleCounts).reduce((sum, count) => sum + count, 0),
    attachmentCount,
  };
  return { ...base, sha256: digest(base) };
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
    for (const moduleName of MIGRATION_EVIDENCE_MODULES) {
      if (moduleName !== "ATTACHMENT") moduleCounts[moduleName] = 0;
    }
    for (const moduleName of Object.keys(legacyMapCountsByModule)) legacyMapCountsByModule[moduleName] = 0;
    expect(validateMigrationTargetStateBinding(modules, {
      ...state,
      moduleCounts,
      legacyMapCountsByModule,
      legacyMapCount: 0,
      recordCount: moduleCounts.ATTACHMENT,
    })).toBe(false);
  });

  it("rejects a LegacyMigrationMap total that is not reconciled per source module", () => {
    const modules = applyModules();
    const state = targetState(modules);
    const legacyMapCountsByModule = { ...(state.legacyMapCountsByModule as Record<string, number>) };
    legacyMapCountsByModule.ORGANIZATION = 0;
    expect(validateMigrationTargetStateBinding(modules, {
      ...state,
      legacyMapCountsByModule,
      legacyMapCount: Number(state.legacyMapCount) - 1,
    })).toBe(false);
  });

  it("allows many source mappings to one distinct linked target while preserving map counts", () => {
    const modules = applyModules();
    const organization = modules.find((moduleRow) => moduleRow.module === "ORGANIZATION")!;
    organization.sourceCount = 2;
    organization.successCount = 0;
    organization.mergedCount = 2;
    const state = targetState(modules);
    expect((state.moduleCounts as Record<string, number>).ORGANIZATION).toBe(1);
    expect((state.legacyMapCountsByModule as Record<string, number>).ORGANIZATION).toBe(2);
    expect(validateMigrationTargetStateBinding(modules, state)).toBe(true);
  });

  it("allows a governed SKIP without a LegacyMigrationMap and distinguishes it from mapped rerun skips", () => {
    const modules = applyModules();
    const organization = modules.find((moduleRow) => moduleRow.module === "ORGANIZATION")!;
    organization.successCount = 0;
    organization.skippedCount = 1;
    const state = targetState(modules, { ORGANIZATION: 1 });
    expect((state.legacyMapCountsByModule as Record<string, number>).ORGANIZATION).toBe(0);
    expect((state.unmappedSkipCountsByModule as Record<string, number>).ORGANIZATION).toBe(1);
    expect((state.moduleCounts as Record<string, number>).ORGANIZATION).toBe(0);
    expect(validateMigrationTargetStateBinding(modules, state)).toBe(true);
  });

  it("rejects an unmapped-skip count larger than the reconciled skipped rows", () => {
    const modules = applyModules();
    const state = targetState(modules);
    const unmappedSkipCountsByModule = { ...(state.unmappedSkipCountsByModule as Record<string, number>), ORGANIZATION: 1 };
    expect(validateMigrationTargetStateBinding(modules, { ...state, unmappedSkipCountsByModule })).toBe(false);
  });

  it("rejects dangling map evidence and a malformed database-state digest", () => {
    const modules = applyModules();
    expect(validateMigrationTargetStateBinding(modules, { ...targetState(modules), danglingLegacyMapCount: 1 })).toBe(false);
    expect(validateMigrationTargetStateBinding(modules, { ...targetState(modules), sha256: "not-a-sha" })).toBe(false);
  });
});
