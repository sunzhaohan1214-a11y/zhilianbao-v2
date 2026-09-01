# PROD Release Checklist

## Go prerequisites

- Exact-head seven CI jobs green: `quality`, `database`, `critical-e2e`, `docker-build`, `security`, `performance`, `browser-compat`.
- `main` protected with required reviews and required exact-head checks.
- UAT signed; P0/P1 count is zero.
- V1 full rehearsal evidence is immutable and passes all of these independent checks:
  - the real FULL manifest and every contract NDJSON file are reopened through local `urn:sha256` plus `sourcePath` pointers, with actual line counts and SHA-256 recomputed;
  - the target is `TEST` and its database ID exactly matches operator-injected `V1_MIGRATION_APPROVED_TARGET_ENVIRONMENT` / `V1_MIGRATION_APPROVED_TARGET_DATABASE`; daily TEST and PROD are forbidden;
  - dry-run, apply and rerun each have a separate immutable execution artifact bound to normalized distinct run/batch IDs, candidate SHA, snapshot, manifest and approved target;
  - top-level reconciliation equals APPLY, attachments were copied/re-read with matching hashes, unresolved BLOCKER/REVIEW counts are zero, and every module equation balances;
  - RERUN writes zero rows and reproduces the same target-state fingerprint as APPLY.
  A SAMPLE package, HTTPS-only migration pointer, non-empty database label, summary boolean or copied result set is not acceptable.
- Production ClamAV health and clean/malware probes pass.
- CynosDB `backupReady=true`; latest successful backup is no older than 24 hours.
- Restore-to-new-cluster drill completed, data validation passed, RTO/RPO recorded, and temporary cluster cleanup confirmed.
- Runtime and migration DB accounts pass the privilege preflight.
- `APP_ENV=prod`, immutable `APP_VERSION`, HTTPS/HSTS decision, secrets, VPC, COS, worker and monitoring are confirmed.
- `npm run release:check -- --mode=prod` reports `RELEASE_READY=YES`.

## Cutover

1. Record V1 write-stop approval and final source snapshot ID.
2. Create and verify V2 pre-release backup.
3. Run `prisma migrate deploy`; never use `prisma db push`.
4. Run approved migration/reconciliation commands with evidence paths.
5. Deploy the exact candidate image and start Web/Worker.
6. Run health, readiness, login, authorization, attachment, core read/write and worker smoke tests.
7. Monitor the initial window and obtain the go/no-go decision.

## Rollback boundary

Code rollback does not restore the database. Data recovery requires maintenance mode, SUPER/operations approval, and the restore runbook. Never execute in-place `RollBackCluster` from application code.
