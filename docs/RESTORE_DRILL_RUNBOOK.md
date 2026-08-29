# Restore Drill Runbook

The automated drill creates a new TEST cluster from a successful CynosDB snapshot. It never restores over the source cluster and never deletes resources automatically.

## Safety gates

- `APP_ENV=test`; production is hard refused.
- `CYNOSDB_ALLOW_RESTORE_DRILL=true`.
- `CYNOSDB_RESTORE_DRILL_COST_ACK=true` after cost approval.
- Source cluster ID, region, zone, VPC and subnet must match provider metadata.
- Target name must start with the configured TEST-only prefix.
- Typed confirmation must equal `RESTORE-TO-NEW-TEST-CLUSTER`.

## Dry run

```bash
npm run restore:drill -- --backup-id=<id> --target-name=zlb-restore-test-<ticket> --confirm=RESTORE-TO-NEW-TEST-CLUSTER
```

Dry run creates evidence only. Add `--execute` only during the approved window. The script submits `RollbackToNewCluster`, records cluster/deal IDs, and stops with validation and manual cleanup still required.

## Required validation

1. Wait for the new cluster to become running; record elapsed time.
2. Connect with a dedicated TEST validation account.
3. Verify schema version, critical table counts, one current ACTIVE batch, ownership/history consistency, attachment metadata/link counts, and latest backup metadata.
4. Run approved key queries and compare to the source snapshot manifest.
5. Record achieved RPO/RTO and any discrepancy.
6. Obtain explicit cleanup approval, delete only the recorded temporary resource IDs, and verify removal and billing cessation.

The drill is not PASS until validation and cleanup evidence exist. Submission alone remains `BLOCKED_BY_EXTERNAL_ENV`.
