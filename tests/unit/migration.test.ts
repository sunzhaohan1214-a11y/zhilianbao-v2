import path from "node:path";
import { describe, expect, it } from "vitest";
import { matchPolicy } from "@/modules/entity-matching";
import { analyzeLegacyRecord, mappedDemandStatus, mappedDemandType, mappedReimbursementStatus } from "@/modules/migration/adapters";
import { sourceFingerprint } from "@/modules/migration/fingerprint";
import { runMigrationPreview } from "@/modules/migration/preview-runner";
import { emptyModule, reconciliationFormulaPass } from "@/modules/migration/reconciliation";
import { SnapshotDirectoryLegacySourceProvider } from "@/modules/migration/snapshot-provider";
import { snapshotManifestSchema, validateLegacyPayload, type LegacyAttachmentManifestRecord } from "@/modules/migration/source-contract";

const fixture = path.resolve("tests/fixtures/v1-migration/sample-v1");

describe("M3-006 source contract and snapshot safety", () => {
  it("validates the versioned manifest, counts, and file hashes", async () => {
    const described = await new SnapshotDirectoryLegacySourceProvider(fixture).describeSnapshot();
    expect(described.manifest).toMatchObject({ sourceSystem: "ZHILIANBAO_V1", schemaVersion: "v1-fixture-1", snapshotKind: "SAMPLE" });
    expect(Object.values(described.manifest.entities).reduce((sum, value) => sum + value, 0)).toBe(26);
    expect(described.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects unknown manifest fields and reports unknown entity fields", () => {
    expect(() => snapshotManifestSchema.parse({ sourceSystem: "ZHILIANBAO_V1", unexpected: true })).toThrow();
    const result = validateLegacyPayload("PERSON", { sourceId: "P-1", name: "甲", memberKind: "ALUMNI_HISTORICAL", unexpected: "non-empty" });
    expect(result.record).toBeUndefined();
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "UNMAPPED_SOURCE_FIELD", severity: "REVIEW" })]));
  });

  it("rejects traversal and symlink-style attachment escape before reading", async () => {
    const provider = new SnapshotDirectoryLegacySourceProvider(fixture);
    const record: LegacyAttachmentManifestRecord = { sourceAttachmentId: "A", sourceEntity: "DEMAND", sourceId: "D", relativePath: "../snapshot.json", sha256: "0".repeat(64), size: 1, originalFilename: "x.txt", declaredMimeType: "text/plain" };
    await expect(provider.getAttachment(record)).rejects.toThrow("MIGRATION_SOURCE_PATH_TRAVERSAL");
  });

  it("uses a deterministic canonical SHA-256 fingerprint", () => {
    expect(sourceFingerprint({ b: 2, a: { d: 4, c: 3 } })).toBe(sourceFingerprint({ a: { c: 3, d: 4 }, b: 2 }));
    expect(sourceFingerprint({ a: 1 })).not.toBe(sourceFingerprint({ a: 2 }));
  });
});

describe("M3-006 shared matchers and fixed legacy semantics", () => {
  it("uses four-key exact policy matching and refuses title-only matching", () => {
    const input = { title: "政策 A", publishingDepartment: "部门", publishedDate: "2026-01-01", primaryFileSha256: "1".repeat(64) };
    expect(matchPolicy(input, [{ id: "p1", ...input }])).toMatchObject({ kind: "EXACT", matchedEntityId: "p1" });
    expect(matchPolicy(input, [{ id: "p2", ...input, primaryFileSha256: "2".repeat(64) }])).toMatchObject({ kind: "CREATE" });
  });

  it("keeps demand and reimbursement mappings fixed", () => {
    expect(mappedDemandStatus("待对接")).toBe("PENDING_CLAIM");
    expect(mappedDemandStatus("已解决")).toBe("COMPLETED");
    expect(mappedDemandType("未知类型")).toBe("OTHER");
    expect(mappedReimbursementStatus("已通过")).toBe("LEGACY_VERIFIED_TERMINAL");
    expect(mappedReimbursementStatus("已通过")).not.toBe("FINANCE_SUBMITTED");
  });

  it("does not create accounts for historical alumni or invent high privileges", () => {
    const person = analyzeLegacyRecord({ sourceId: "P", entityType: "PERSON", payload: { sourceId: "P", name: "甲", phone: "13800000000", memberKind: "ALUMNI_HISTORICAL", accountEligible: true, currentEmploymentConfirmed: false } });
    expect(person).toMatchObject({ classification: "REVIEW" });
    expect(person.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "PERSON_ACCOUNT_ELIGIBILITY_UNCONFIRMED" })]));
    const role = analyzeLegacyRecord({ sourceId: "R", entityType: "ROLE", payload: { sourceId: "R", personSourceId: "P", roleCode: "SUPER_ADMIN", explicitlyAuditable: false } });
    expect(role).toMatchObject({ classification: "REVIEW" });
  });

  it("marks legacy presence historical and non-mappable trips for review", () => {
    expect(analyzeLegacyRecord({ sourceId: "P", entityType: "PRESENCE", payload: { sourceId: "P" } })).toMatchObject({ classification: "SUCCESS", immutableHistory: true });
    expect(analyzeLegacyRecord({ sourceId: "T", entityType: "TRIP", payload: { sourceId: "T", stableV2Nodes: false } })).toMatchObject({ classification: "REVIEW", targetEntity: "HISTORICAL_WORK_RECORD" });
  });
});

describe("M3-006 sample rehearsal and reconciliation", () => {
  it("runs 26 sanitized records with normal, review, blocker, and attachment exception coverage", async () => {
    const result = await runMigrationPreview(new SnapshotDirectoryLegacySourceProvider(fixture), { mode: "SAMPLE_REHEARSAL", fullSnapshotAvailable: false });
    expect(result.reconciliation.totals.sourceCount).toBe(29);
    expect(result.reconciliation.formulaPass).toBe(true);
    expect(result.reconciliation.fullRehearsalStatus).toBe("FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT");
    expect(result.issues.some(({ severity }) => severity === "BLOCKER")).toBe(true);
    expect(result.issues.some(({ severity }) => severity === "REVIEW")).toBe(true);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "MIGRATION_ATTACHMENT_MISSING" }),
      expect.objectContaining({ code: "MIGRATION_ATTACHMENT_HASH_MISMATCH" }),
      expect.objectContaining({ code: "REIMBURSEMENT_LEGACY_VERIFIED_TERMINAL" }),
    ]));
  });

  it("refuses a full rehearsal when the source is only the sample fixture", async () => {
    await expect(runMigrationPreview(new SnapshotDirectoryLegacySourceProvider(fixture), { mode: "FULL_REHEARSAL" })).rejects.toThrow("FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT");
  });

  it("requires every source row and attachment to have one explained bucket", () => {
    const moduleResult = { ...emptyModule("DEMAND"), sourceCount: 4, successCount: 1, failedCount: 1, skippedCount: 0, mergedCount: 1, reviewCount: 1 };
    expect(reconciliationFormulaPass(moduleResult)).toBe(true);
    moduleResult.reviewCount = 0;
    expect(reconciliationFormulaPass(moduleResult)).toBe(false);
  });
});
