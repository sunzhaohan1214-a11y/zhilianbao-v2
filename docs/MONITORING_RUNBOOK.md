# Monitoring Runbook

## Signals

- Web health/readiness, HTTP 5xx and latency.
- Worker lease loss, retry exhaustion, outbox/job backlog and shutdown timeout.
- Authentication failures/rate limits and authorization denials.
- Attachment scanner health, scan failures and quarantined files.
- Backup provider health, latest successful age, retention unknown/failures.
- Restore/maintenance state, with at most one active restore.
- AI/OCR provider status, timeout/error rate and safe-fallback rate; never log prompts, responses, phone, IDs, tokens or invoice bodies.
- Database connections, slow queries, lock waits, storage and replication/backup state.

## Severity

- P0: confirmed data loss/corruption, active credential exposure, broad authorization bypass, production unavailable.
- P1: scanner unavailable, backup older than 24 hours, sustained core 5xx, worker backlog preventing business completion.
- P2: degraded optional AI/OCR or isolated non-core failure with safe fallback.

## Response

1. Declare owner, incident ID, environment, start time and exact app version.
2. Preserve redacted logs and provider request/resource IDs; do not paste secrets or private bodies.
3. Contain using the narrowest reversible action. Maintenance mode requires the approved provider and operations authority.
4. For database recovery, follow `RESTORE_DRILL_RUNBOOK.md`/production recovery approval; code rollback alone never restores data.
5. Validate recovery with health, authorization, scanner, database consistency and worker checks.
6. Record timeline, impact, root cause confidence, corrective actions and closure approval.
