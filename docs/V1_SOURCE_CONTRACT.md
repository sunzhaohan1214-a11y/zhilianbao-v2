# 智链宝 V1 Snapshot Source Contract

> Contract version: `v1-fixture-1`  
> Source: read-only directory snapshot only  
> Status: sample contract implemented; real V1 contract pending a controlled schema/snapshot

## 1. Boundary

This repository does not contain the real V1 database schema, SQL dump, field mapping, full snapshot, or attachment manifest. The contract in this document is therefore a versioned, sanitized fixture contract used to verify the migration framework. It must not be presented as the real V1 physical schema.

The runner never accepts `V1_PROD_DATABASE_URL`. It reads only the `--source` directory and writes only to the configured V2 database when `--apply --confirm MIGRATE_TO_V2` is present. `APP_ENV=production` is refused by this milestone.

## 2. Directory layout

```text
snapshot-root/
  snapshot.json
  entities/
    organizations.ndjson
    persons.ndjson
    enterprises.ndjson
    talents.ndjson
    policies.ndjson
    demands.ndjson
    presence.ndjson
    trips.ndjson
    visits.ndjson
    reimbursements.ndjson
    helps.ndjson
    announcements.ndjson
    roles.ndjson
  attachments/
    manifest.ndjson
    blobs/...
  migration-resolutions.json   # optional, versioned governance input
```

Every NDJSON file is UTF-8, one object per non-empty line, ordered by `sourceId` ascending. The provider streams lines and rejects duplicate source IDs, malformed JSON, traversal, absolute paths, symlinks, and resolved paths outside the snapshot root.

## 3. `snapshot.json`

The strict manifest contains:

- `sourceSystem`: exactly `ZHILIANBAO_V1`;
- `schemaVersion`, `snapshotId`, `snapshotAt`, `exportedAt`;
- `isSanitized` and `snapshotKind` (`SAMPLE` or `FULL`);
- `mappingVersion`;
- `files`: expected line count and SHA-256 for every NDJSON file;
- `entities`: expected record count for every entity module.

Startup re-reads every declared file, verifies SHA-256 and line count, then reconciles file counts to entity counts before any batch can run. Unknown manifest keys fail strict validation.

## 4. Entity semantics

The TypeScript Zod schemas in `src/modules/migration/source-contract.ts` are the executable contract. Unknown non-empty fields generate `UNMAPPED_SOURCE_FIELD`; invalid required fields generate `MIGRATION_SOURCE_INVALID`. Neither case is silently discarded.

Key semantics:

- Person matching uses the shared `matchPerson`; missing, invalid, duplicate, same-name/different-phone, and archived identities require governance. Historical alumni default to no account.
- Enterprise matching uses shared `matchEnterprise`; credit code is authoritative. A no-code name/area match is review-only. Coordinates never change responsible area.
- Talent matching uses shared `matchTalent`; resume text never creates structured phone/email. Missing recommender is review-only.
- Policy uses the shared four-key matcher: title + publishing department + date + primary-file SHA-256.
- Demand maps `待对接/已对接/已解决` to `PENDING_CLAIM/IN_PROGRESS/COMPLETED`; historical completed demand does not re-run close review or invent Outcome/timeline.
- Presence is historical only. Unstable legacy trips remain historical work records instead of fabricated V2 nodes.
- `已通过` reimbursement maps only to `LEGACY_VERIFIED_TERMINAL`, a read-only terminal; it never maps to `FINANCE_SUBMITTED`.
- Unknown Help categories map to `OTHER` while the source snapshot is retained.
- Historical announcements do not fabricate confirmations or replay Message/Todo/Outbox.
- High-privilege roles require explicit auditable evidence.

## 5. Attachments

Each attachment manifest row includes source identity, owner entity/source ID, path relative to `attachments/blobs`, expected SHA-256, expected size, original filename, and declared MIME type. Preview verifies source existence, size, and hash. Apply implementations must copy to private target storage, re-read the target, verify size/hash, create `Attachment` and `AttachmentLink`, and record `MigrationAttachmentResult`. Missing, corrupt, copy-failed, hash-mismatch, scan-rejected, and skipped results remain auditable.

## 6. Fingerprint and rerun

`sourceFingerprint = SHA-256(canonical JSON payload)`. Object keys are recursively sorted; runtime timestamps and random values are not added. `LegacyMigrationMap` is unique on source system/entity/ID. Same-snapshot reruns retain the target ID. Mutable current facts may update through formal version/audit helpers. Changed immutable historical records raise `MIGRATION_SOURCE_HISTORY_CHANGED` and are never overwritten.

## 7. Real V1 onboarding gate

Before replacing `v1-fixture-1`, governance must provide a controlled schema and snapshot, approve field mappings, update the contract version, regenerate sanitized fixtures, and rerun all gates. Until then:

```text
Sample rehearsal: supported
Full rehearsal: FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT
Formal cutover: prohibited
```
