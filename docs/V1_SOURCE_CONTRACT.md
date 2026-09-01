# 智链宝 V1 Snapshot Source Contract

> Contract version: `v1-fixture-1`  
> Source: read-only directory snapshot only  
> Status: sample contract and local reference-package adapter implemented; real V1 FULL contract still requires a controlled final schema/snapshot

## 1. Boundary

This repository does not contain the real V1 database schema, SQL dump, field mapping, full snapshot, or attachment manifest. The contract in this document is therefore a versioned, sanitized fixture contract used to verify the migration framework. It must not be presented as the real V1 physical schema.

The runner never accepts `V1_PROD_DATABASE_URL`. It reads only the `--source` directory and writes only to the configured V2 database when `--apply --confirm MIGRATE_TO_V2` is present. Environment matching is trimmed and case-insensitive: `prod` and `production` (including upper-case variants) are always refused. Apply also refuses a missing or unknown `APP_ENV`; only an explicit normalized LOCAL or TEST identity may reach the apply runner. Dry-run may use an unknown non-production identity because it performs no V2 business write, but production aliases remain refused.

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
- Reference-package contacts use `INTERNAL_STAFF`; not-yet-active batch members use `FUTURE_MEMBER_CANDIDATE`. Neither value creates a current BatchMembership or account without separate current-employment governance.
- Enterprise matching uses shared `matchEnterprise`; credit code is authoritative. A no-code name/area match is review-only. Coordinates never change responsible area.
- Talent matching uses shared `matchTalent`; resume text never creates structured phone/email. Missing recommender is review-only.
- Policy uses the shared four-key matcher: title + publishing department + date + primary-file SHA-256.
- Demand maps `待对接/已对接/已解决` to `PENDING_CLAIM/IN_PROGRESS/COMPLETED`; historical completed demand does not re-run close review or invent Outcome/timeline.
- Presence/Trip/Visit are `MIGRATION_APPLY_UNSUPPORTED` review items until V2 has a safe historical representation; they are never counted as apply success without target rows.
- `已通过` reimbursement maps only to `LEGACY_VERIFIED_TERMINAL`, a read-only terminal; it never maps to `FINANCE_SUBMITTED`.
- PENDING Help can be created with an `OTHER` category while retaining the source category snapshot. Non-PENDING Help without reliable current owner and required lifecycle timestamps is `MIGRATION_APPLY_UNSUPPORTED` review-only; those facts are never invented to satisfy V2 state constraints.
- Historical announcements do not fabricate confirmations or replay Message/Todo/Outbox.
- High-privilege roles require explicit auditable evidence.

## 5. Attachments

Each attachment manifest row includes source identity, owner entity/source ID, path relative to `attachments/blobs`, expected SHA-256, expected size, original filename, and declared MIME type. Preview returns source `VALIDATED`, never `COPIED`. Apply reuses the formal Attachment file policy and scanner interface: filename/extension allowlist, declared MIME, detected magic type, executable-signature rejection, size, and malware result must all pass. It then copies to private target storage, re-reads the target, verifies size/hash, and only then atomically creates the formal `AttachmentLink`, attachment Map, and `MigrationAttachmentResult(COPIED)` with non-null target fields. Missing, corrupt, parent-unresolved, copy-failed, hash-mismatch, type/MIME/signature rejection, scanner-unavailable, and skipped results remain auditable and fail closed.

## 6.1 Resolution contract

`migration-resolutions.json` is strict and versioned. Duplicate source keys or malformed LINK targets fail before apply. CREATE/LINK/SKIP/WAIVE are adapter-governed: WAIVE cannot manufacture success, LINK must point to the expected live entity, and ARCHIVED Person, DISABLED/MERGED Enterprise, and RoleAssignment governance cannot be bypassed. The JSON `operator` is retained only as source lineage.

## 6. Fingerprint and rerun

`sourceFingerprint = SHA-256(canonical JSON payload)`. Object keys are recursively sorted; runtime timestamps and random values are not added. `LegacyMigrationMap` is unique on source system/entity/ID. Same-snapshot reruns retain the target ID. A different fingerprint may advance only after CREATE/LINK to a verified real target or a supported formal UPDATE; ordinary SKIP requires an equal fingerprint. Unsupported mutable drift is `MIGRATION_SOURCE_CHANGED_REQUIRES_REVIEW` and preserves the old target/fingerprint. Changed immutable historical records raise `MIGRATION_SOURCE_HISTORY_CHANGED` and are never overwritten. `upsertMap` independently rejects an unapproved fingerprint advance.

## 7. Real V1 onboarding gate

Before replacing `v1-fixture-1`, governance must provide a controlled schema and snapshot, approve field mappings, update the contract version, regenerate sanitized fixtures, and rerun all gates. Until then:

```text
Sample rehearsal: supported
Full rehearsal: FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT
Formal cutover: prohibited
```

## 8. Local reference-package adapter

`docs/V1_REFERENCE_PACKAGE_ADAPTER.md` describes the checksum-verified adapter for the local reference export. Its output is always `SAMPLE`, `isSanitized=false`, and ineligible for FULL rehearsal evidence.
