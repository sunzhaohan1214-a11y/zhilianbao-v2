-- M2-003 Presence is an expand-only foundation. Current presence is derived
-- from the interval and cancellation marker; no attendance or location data is stored.

CREATE TABLE `presence_reports` (
  `id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `arrival_at` DATETIME(3) NOT NULL,
  `expected_departure_at` DATETIME(3) NOT NULL,
  `origin` VARCHAR(200) NULL,
  `transport_mode` VARCHAR(100) NULL,
  `train_flight_no` VARCHAR(100) NULL,
  `note` VARCHAR(1000) NULL,
  `canceled_at` DATETIME(3) NULL,
  `cancel_reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `presence_person_active_interval_idx`(`person_id`, `canceled_at`, `arrival_at`, `expected_departure_at`),
  INDEX `presence_current_interval_idx`(`arrival_at`, `expected_departure_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `presence_interval_order_check` CHECK (`expected_departure_at` > `arrival_at`),
  CONSTRAINT `presence_cancel_reason_check` CHECK (
    (`canceled_at` IS NULL AND `cancel_reason` IS NULL)
    OR (`canceled_at` IS NOT NULL AND `cancel_reason` IS NOT NULL AND CHAR_LENGTH(TRIM(`cancel_reason`)) > 0)
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `presence_reports`
  ADD CONSTRAINT `presence_reports_person_id_fkey`
  FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
