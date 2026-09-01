import { describe, expect, it } from "vitest";
import {
  CONTROLLED_FULL_CLASSIFICATION,
  CONTROLLED_FULL_SCHEMA_VERSION,
  manifestAllowsApply,
  manifestAllowsFullRehearsal,
  snapshotManifestSchema,
} from "@/modules/migration/source-contract";

const base = {
  sourceSystem: "ZHILIANBAO_V1" as const,
  snapshotId: "full-snapshot-20260901",
  snapshotAt: "2026-09-01T00:00:00.000Z",
  exportedAt: "2026-09-01T00:10:00.000Z",
  isSanitized: false,
  mappingVersion: "m3-006-v1",
  files: {},
  entities: {},
};

function controlledFull() {
  return snapshotManifestSchema.parse({
    ...base,
    schemaVersion: CONTROLLED_FULL_SCHEMA_VERSION,
    snapshotKind: "FULL",
    sourceAdapter: "STANDARD_SNAPSHOT",
    sourceClassification: CONTROLLED_FULL_CLASSIFICATION,
    applyEligible: true,
    fullRehearsalEligible: true,
  });
}

describe("FULL migration source authorization", () => {
  it("allows FULL only with the recognized controlled schema, provenance and explicit positive authorizations", () => {
    const manifest = controlledFull();
    expect(manifestAllowsApply(manifest)).toBe(true);
    expect(manifestAllowsFullRehearsal(manifest)).toBe(true);
  });

  it.each([
    ["unrecognized schema", { schemaVersion: "v1-full-1" }],
    ["missing source adapter", { sourceAdapter: undefined }],
    ["wrong classification", { sourceClassification: "CONTROLLED_EXPORT" }],
    ["missing apply authorization", { applyEligible: undefined }],
    ["negative apply authorization", { applyEligible: false }],
    ["missing FULL authorization", { fullRehearsalEligible: undefined }],
    ["negative FULL authorization", { fullRehearsalEligible: false }],
  ])("rejects %s", (_label, patch) => {
    expect(() => snapshotManifestSchema.parse({
      ...base,
      schemaVersion: CONTROLLED_FULL_SCHEMA_VERSION,
      snapshotKind: "FULL",
      sourceAdapter: "STANDARD_SNAPSHOT",
      sourceClassification: CONTROLLED_FULL_CLASSIFICATION,
      applyEligible: true,
      fullRehearsalEligible: true,
      ...patch,
    })).toThrow();
  });

  it("rejects a repackaged reference export that strips optional provenance and merely relabels itself FULL", () => {
    expect(() => snapshotManifestSchema.parse({
      ...base,
      schemaVersion: "arbitrary-repacked-schema",
      snapshotKind: "FULL",
    })).toThrow();
  });

  it("does not make ordinary SAMPLE snapshots opt-in FULL by accident", () => {
    const sample = snapshotManifestSchema.parse({
      ...base,
      schemaVersion: "v1-fixture-1",
      snapshotKind: "SAMPLE",
    });
    expect(manifestAllowsApply(sample)).toBe(true);
    expect(manifestAllowsFullRehearsal(sample)).toBe(false);
  });
});
