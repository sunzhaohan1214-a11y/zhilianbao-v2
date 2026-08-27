-- Expand-only fields let the transactional Outbox consumer schedule retries and
-- stop poison events without overloading published_at with a false meaning.
ALTER TABLE `outbox_events`
  ADD COLUMN `next_attempt_at` DATETIME(3) NULL,
  ADD COLUMN `failed_at` DATETIME(3) NULL;

CREATE INDEX `outbox_consume_retry_idx`
  ON `outbox_events`(`published_at`, `failed_at`, `next_attempt_at`, `occurred_at`);
