# 智链宝 V1 → V2 Migration Runbook

## 1. Prerequisites

- Use an isolated feature/release branch and an isolated V2 Migration database.
- Never point LOCAL/TEST or this runner at V1 PROD.
- Obtain an approved, read-only snapshot directory that conforms to `V1_SOURCE_CONTRACT.md`.
- Confirm the snapshot classification (`SAMPLE` or controlled `FULL`), checksum manifest, attachment inventory, schema/mapping version, and operator authorization.
- For apply, use an active `SUPER_ADMIN` operator with `migration.execute`; do not use a shared account.
- Take a V2 Migration DB restore point before every apply rehearsal.
- Set `APP_ENV` explicitly before apply. Normalized LOCAL aliases are `local/development/dev`; normalized TEST aliases are `test/testing/uat/staging`. `prod/PROD/production/PRODUCTION` are refused in every mode, while a missing or unknown apply environment is refused with `MIGRATION_APPLY_ENVIRONMENT_REQUIRED`.
- Before generating release evidence, inject `V1_MIGRATION_APPROVED_TARGET_ENVIRONMENT=TEST` and `V1_MIGRATION_APPROVED_TARGET_DATABASE=<dedicated-migration-db-id>`. These values identify the independently approved isolated target; they are not inferred from `APP_ENV` or from `DATABASE_URL` and must never name daily TEST or PROD.

## 2. Build and sample rehearsal

```bash
npm ci
npm run db:validate
npm run db:generate
npm run build:migration
npm run migration:v1 -- \
  --source ./tests/fixtures/v1-migration/sample-v1 \
  --mode sample \
  --dry-run
```

Dry-run parses, strictly validates, matches, classifies issues, checks attachments, and writes JSON/XLSX reconciliation reports. It must not write V2 business tables.

Apply is protected by all three parameters:

```bash
npm run migration:v1 -- \
  --source <approved-snapshot-root> \
  --mode sample \
  --apply \
  --resolutions <approved-migration-resolutions.json> \
  --operator <active-super-admin-person-id> \
  --confirm MIGRATE_TO_V2
```

If `--resolutions` is omitted, the runner strictly loads `<snapshot-root>/migration-resolutions.json`. The file's version and SHA-256 are recorded in batch reconciliation; its `operator` field is lineage only and never replaces the authenticated active `SUPER_ADMIN`.

`--apply` starts `MigrationApplyRunner` against the dedicated V2 Migration DB. Each source aggregate writes the target business row, required audit/version/history, and `LegacyMigrationMap` in one transaction. It does not persist preview `SUCCESS` as an apply result. Modules without a safe apply adapter remain `REVIEW/MIGRATION_APPLY_UNSUPPORTED`.

The sample contains 26 sanitized business records and three attachment cases. It intentionally includes normal, merge/link, REVIEW, BLOCKER, missing attachment, and hash-mismatch outcomes. A sample batch with unresolved review/blocker issues finishes as `REVIEW_REQUIRED`, not `SUCCEEDED`.

## 3. Full rehearsal

Run only when a controlled real full snapshot and schema are supplied. The snapshot must declare `snapshotKind=FULL`.

```bash
npm run migration:v1 -- --source <controlled-full-snapshot> --mode full --dry-run
npm run migration:v1 -- --source <controlled-full-snapshot> --mode full --apply --operator <person-id> --confirm MIGRATE_TO_V2
```

Use only a dedicated V2 Migration DB. Never use daily TEST or V2 PROD. A sample snapshot passed with `--mode full` is rejected as `FULL_REHEARSAL_BLOCKED_BY_SOURCE_SNAPSHOT`.

## 4. Issue resolution

1. Export issues JSON and group by module/code/severity.
2. Fix deterministic mapping code when the rule is wrong; do not hand-edit target rows.
3. Record approved entity decisions in versioned `migration-resolutions.json`: source entity/ID, action, target, reason, and operator.
4. Resolve or waive only through governed commands with actor/time/reason.
5. Reset the dedicated Migration DB to its pre-rehearsal restore point and rerun.

`WARNING` may coexist with success. `REVIEW` requires an explicit decision. Any unresolved `BLOCKER` prevents `SUCCEEDED`.

## 5. Rerun and idempotency checks

For the same snapshot verify:

- target entity counts do not increase;
- `LegacyMigrationMap` does not duplicate or change target IDs;
- accounts, attachments, versions, histories, and demand progress do not duplicate;
- no historical Message/Todo/Outbox is created;
- all module equations remain balanced.

For attachments, `COPIED` means the source passed the same formal Attachment filename/extension, declared MIME, detected magic type, executable-signature, size, and scanner policy before the private target object was written; the target was then re-read, hash/size checked, formally linked, assigned a non-null `targetAttachmentId`, and mapped. Source-only validation is reported as planned validation during dry-run and never as `COPIED`. Scanner unavailability fails closed and never writes `scanStatus=PASSED`.

For a new snapshot, compare the current source fingerprint before any same-snapshot skip. A changed mutable record may advance its Map fingerprint only after a supported formal UPDATE has changed the same target with required version/audit evidence. Otherwise it is `MIGRATION_SOURCE_CHANGED_REQUIRES_REVIEW`, while the target and old fingerprint remain unchanged. Changed immutable history raises `MIGRATION_SOURCE_HISTORY_CHANGED` and fails closed.

## 6. Reconciliation

Review JSON and XLSX. For every module:

```text
source = success + failed + skipped + merged + review
attachments = attachment success + attachment issues
```

Also sample: Demand→Enterprise, Demand→Contact, Person→Account, Person→Appointment/Membership, Reimbursement→Invoice, Policy→Primary file. Explain count reductions with merge/link counts and map evidence. Person count is not expected to equal Account count; report eligible accounts, created accounts, and historical no-account records separately. Presence reconciliation is historical only.

### Release-evidence handoff draft

The migration evidence document remains `status=PASS` only after a controlled FULL dry-run, apply and idempotent rerun have completed. Migration evidence is intentionally stricter than the other release categories: the outer document and every nested snapshot/execution artifact must use a local immutable pointer with both `urn:sha256:<digest>` and `sourcePath`. The controlled readiness runner must be able to reopen the exact local bytes; HTTPS-only migration evidence is rejected.

Its `details` must include all of the following; omitted fields, copied summaries and self-reported booleans are rejected by `validateMigrationEvidence()`:

- `snapshotManifest`, an immutable pointer to the real `snapshot.json`; the gate reads, hashes and parses it, requires the manifest itself to say `snapshotKind=FULL`, and binds its `snapshotId` to `sourceSnapshotIdentity`;
- `snapshotKind=FULL`, `rehearsalMode=FULL_REHEARSAL`, `fullRehearsalStatus=COMPLETED` and a `manifestSha256` equal to the bytes addressed by `snapshotManifest`;
- one `manifestFiles` metadata row and one `snapshotFiles` immutable pointer for every contract NDJSON path, including `attachments/manifest.ndjson`; the gate reopens each actual file, parses every non-empty line as a JSON object, then recomputes both record count and SHA-256 instead of trusting copied metadata;
- `attachmentInventory` bound to the attachment manifest row, with source/copied/hash-verified counts equal for APPLY, zero issues, and `validationPassed=true`;
- normalized, whitespace-free and globally distinct `dryRunId`, apply `migrationBatchId/migrationRunId`, and rerun `rerunBatchId/rerunRunId`;
- `targetMigrationEnvironment=TEST` and `targetMigrationDatabase` exactly matching `V1_MIGRATION_APPROVED_TARGET_ENVIRONMENT` and `V1_MIGRATION_APPROVED_TARGET_DATABASE` injected by the release operator;
- `executionEvidence` containing exactly three immutable artifacts: `dryRun`, `apply` and `rerun`. Each artifact binds its phase, run/batch identity, candidate SHA, source snapshot identity, manifest digest and approved target database, and contains its own module reconciliation, attachment inventory, write summary and target-state fingerprint;
- top-level module and attachment results byte-for-byte/canonically equal to the APPLY artifact, preventing a result set from another run being paired with valid-looking IDs;
- a RERUN artifact with `idempotencyPassed=true`, zero created/updated/deleted rows and the same canonical target-state counts/fingerprint as APPLY;
- `unresolvedBlockerCount=0` and `unresolvedReviewCount=0`;
- exactly one reconciliation row for every source module and `ATTACHMENT`, with `source = success + failed + skipped + merged + review`, `attachments = attachment success + attachment issues`, and zero failed, review or attachment-issue counts;
- `dryRunPassed`, `applyPassed`, `rerunPassed`, and `reconciliationPassed` all true as summary fields only; the immutable execution artifacts remain authoritative.

This is a handoff contract, not proof that a FULL snapshot exists. Until real immutable evidence satisfies it, release status remains `BLOCKED_BY_SOURCE_DATA` and `RELEASE_READY=NO`.

## 7. Security and privacy checks

- Logs contain only batch/module, hashed source ID, result, duration, issue code, and counts.
- No password, full phone, reimbursement body, attachment content, token, or secret appears in logs/reports.
- Attachments remain private, parent-authorized, short-signed, scanned, and access-logged.
- Ordinary ADMIN still cannot read another person's reimbursement body.
- Help remains visible only to its private relationship set.
- Unpublished data remains isolated.
- Migration audit exists; historical user notification replay does not.

## 8. Abort conditions

Abort release if any is true:

- core table counts cannot be reconciled;
- person/account matching is materially wrong;
- critical attachments are missing at scale;
- permission isolation fails;
- core demand lifecycle is unusable;
- reimbursement visibility or legacy-terminal semantics are wrong;
- rerun is not idempotent.

Do not open V2 while an abort condition exists.

## 9. Reset and rollback

For rehearsal errors, restore the dedicated Migration DB to its pre-rehearsal snapshot and rerun. Never issue ad-hoc bulk UPDATEs to make counts match.

For a later formal cutover: code defects use code rollback without database restore. If migrated data itself is wrong and must be rebuilt, enter maintenance, restore the approved pre-cutover database/object snapshot, and rerun the approved runbook.

## 10. Formal cutover handoff — documented, not executed here

1. Freeze V1 writes.
2. Take final V1 backup.
3. Take V2 PROD pre-cutover snapshot.
4. Run approved final incremental migration.
5. Verify every attachment.
6. Reconcile counts and relationships.
7. Resolve approved manual issues.
8. Run UAT/smoke and security checks.
9. Release V2.
10. Shut down V1.

This M3-006 milestone does not execute any of those ten production actions and never auto-signs a batch.
