# Database Privilege Runbook

Production credentials are injected by the environment and never stored in Git, images, logs, or evidence.

## Accounts

- Runtime account: required DML and connection permissions only; no schema creation/alter/drop or account administration.
- Migration account: DDL needed by approved `prisma migrate deploy`, available only during controlled release work.

## Preflight

1. In TEST with production-equivalent grants, run the application read/write, transaction, row-lock, worker and outbox suites as the runtime account.
2. Confirm runtime attempts to create/alter/drop schema objects fail.
3. Run `prisma migrate deploy` twice as the migration account and confirm the second run is idempotent.
4. Revoke/rotate temporary migration access after release and retain only redacted grant evidence.

If separate external accounts are unavailable, report `BLOCKED_BY_EXTERNAL_ENV`; do not reuse an over-privileged credential and call the check passed.
