import { describe, expect, it } from "vitest";
import {
  CONTROLLED_FULL_CLASSIFICATION,
  CONTROLLED_FULL_SCHEMA_VERSION,
  SANITIZED_FIXTURE_CLASSIFICATION,
  SANITIZED_FIXTURE_SCHEMA_VERSION,
  manifestAllowsApply,
  manifestAllowsFullRehearsal,
  snapshotManifestSchema,
} from "@/modules/migration/source-contract";
import { LEGACY_ENTITY_TYPES } from "@/modules/migration/types";

const base = {
  sourceSystem: "ZHILIANBAO_V1" as const,
  snapshotId: "full-snapshot-20260901",
  snapshotAt: "2026-09-01T00:00:00.000Z",
  exportedAt: "2026-09-01T00:10:00.000Z",
  isSanitized: false,
  mappingVersion: "m3-006-v1",
  files: {},
  entities: Object.fromEntries(LEGACY_ENTITY_TYPES.map((entityType) => [entityType, 0])),
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

  it("allows SAMPLE apply only for the explicitly authorized sanitized fixture provenance", () => {
    const sample = snapshotManifestSchema.parse({
      ...base,
      schemaVersion: SANITIZED_FIXTURE_SCHEMA_VERSION,
      snapshotKind: "SAMPLE",
      sourceAdapter: "STANDARD_SNAPSHOT",
      sourceClassification: SANITIZED_FIXTURE_CLASSIFICATION,
      applyEligible: true,
      fullRehearsalEligible: false,
      isSanitized: true,
    });
    expect(manifestAllowsApply(sample)).toBe(true);
    expect(manifestAllowsFullRehearsal(sample)).toBe(false);
  });

  it("keeps an unrecognized SAMPLE preview-only even when it self-asserts apply eligibility", () => {
    const sample = snapshotManifestSchema.parse({
      ...base,
      schemaVersion: "arbitrary-repacked-schema",
      snapshotKind: "SAMPLE",
      applyEligible: true,
      fullRehearsalEligible: false,
    });
    expect(manifestAllowsApply(sample)).toBe(false);
    expect(manifestAllowsFullRehearsal(sample)).toBe(false);
  });
});
