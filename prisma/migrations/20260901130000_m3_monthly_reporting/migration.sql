-- C-M3-004 is expand-only. The task stores an immutable query/scope snapshot;
-- the worker re-checks current permission before writing one private output.

ALTER TABLE `presence_reports`
  ADD COLUMN `source_system` VARCHAR(50) NOT NULL DEFAULT 'V2',
  ADD COLUMN `source_record_id` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `presence_reports_source_system_source_record_id_key` (`source_system`, `source_record_id`);

CREATE TABLE `monthly_report_export_tasks` (
  `id` CHAR(36) NOT NULL,
  `month` CHAR(7) NOT NULL,
  `batch_id` CHAR(36) NULL,
  `query_snapshot` JSON NOT NULL,
  `scope_snapshot` JSON NOT NULL,
  `status` ENUM('WAITING', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'WAITING',
  `created_by_person_id` CHAR(36) NOT NULL,
  `output_attachment_id` CHAR(36) NULL,
  `idempotency_key_hash` CHAR(64) NOT NULL,
  `payload_hash` CHAR(64) NOT NULL,
  `started_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `error_code` VARCHAR(100) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `monthly_report_export_tasks_output_attachment_id_key` (`output_attachment_id`),
  UNIQUE INDEX `monthly_report_export_actor_key` (`created_by_person_id`, `idempotency_key_hash`),
  INDEX `monthly_report_export_tasks_created_by_person_id_created_at_idx` (`created_by_person_id`, `created_at`),
  INDEX `monthly_report_export_tasks_status_created_at_idx` (`status`, `created_at`),
  INDEX `monthly_report_export_tasks_batch_id_month_idx` (`batch_id`, `month`),
  CONSTRAINT `monthly_report_export_tasks_month_check` CHECK (`month` REGEXP '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT `monthly_report_export_tasks_status_shape_check` CHECK (
    (`status` = 'WAITING' AND `started_at` IS NULL AND `finished_at` IS NULL AND `output_attachment_id` IS NULL AND `error_code` IS NULL)
    OR (`status` = 'RUNNING' AND `started_at` IS NOT NULL AND `finished_at` IS NULL AND `output_attachment_id` IS NULL)
    OR (`status` = 'SUCCEEDED' AND `started_at` IS NOT NULL AND `finished_at` IS NOT NULL AND `output_attachment_id` IS NOT NULL AND `error_code` IS NULL)
    OR (`status` = 'FAILED' AND `started_at` IS NOT NULL AND `finished_at` IS NOT NULL AND `output_attachment_id` IS NULL AND `error_code` IS NOT NULL)
  ),
  CONSTRAINT `monthly_report_export_tasks_batch_id_fkey`
    FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `monthly_report_export_tasks_created_by_person_id_fkey`
    FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `monthly_report_export_tasks_output_attachment_id_fkey`
    FOREIGN KEY (`output_attachment_id`) REFERENCES `attachments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
