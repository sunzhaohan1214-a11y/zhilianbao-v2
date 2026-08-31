# PROD Release Checklist

## Go prerequisites

- Exact-head seven CI jobs green: `quality`, `database`, `critical-e2e`, `docker-build`, `security`, `performance`, `browser-compat`.
- `main` protected with required reviews and required exact-head checks.
- UAT signed; P0/P1 count is zero.
- V1 full rehearsal evidence is immutable and passes the complete manifest-file counts/SHA-256, attachment inventory/re-read, distinct batch/run identity, zero unresolved BLOCKER/REVIEW, per-module equations, timing, idempotent rerun, and rollback-decision gates. A SAMPLE or summary boolean is not acceptable.
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
