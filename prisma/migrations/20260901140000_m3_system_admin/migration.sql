-- M3-007 is expand-only. Backup and restore tables store metadata/orchestration state only.
CREATE TABLE `system_settings` (
  `id` CHAR(36) NOT NULL, `key` VARCHAR(100) NOT NULL, `value_json` JSON NULL,
  `value_type` VARCHAR(32) NOT NULL, `version` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `updated_by_person_id` CHAR(36) NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `system_settings_key_key`(`key`), INDEX `system_settings_updated_by_person_id_updated_at_idx`(`updated_by_person_id`, `updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `system_setting_versions` (
  `id` CHAR(36) NOT NULL, `setting_id` CHAR(36) NOT NULL, `version` INTEGER UNSIGNED NOT NULL,
  `before_json` JSON NULL, `after_json` JSON NOT NULL, `reason` VARCHAR(500) NOT NULL,
  `changed_by_person_id` CHAR(36) NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `system_setting_versions_setting_id_version_key`(`setting_id`, `version`),
  INDEX `system_setting_versions_changed_by_person_id_created_at_idx`(`changed_by_person_id`, `created_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `work_calendar_overrides` (
  `id` CHAR(36) NOT NULL, `date` DATE NOT NULL, `day_type` ENUM('WORKDAY','HOLIDAY') NOT NULL,
  `name` VARCHAR(100) NULL, `reason` VARCHAR(500) NOT NULL, `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `updated_by_person_id` CHAR(36) NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `work_calendar_overrides_date_key`(`date`), INDEX `work_calendar_overrides_updated_by_person_id_updated_at_idx`(`updated_by_person_id`, `updated_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `system_command_idempotencies` (
  `id` CHAR(36) NOT NULL, `actor_person_id` CHAR(36) NOT NULL, `action` VARCHAR(100) NOT NULL,
  `key_hash` CHAR(64) NOT NULL, `payload_hash` CHAR(64) NOT NULL, `aggregate_type` VARCHAR(100) NOT NULL,
  `aggregate_id` CHAR(36) NULL, `response_json` JSON NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `system_command_idempotencies_actor_person_id_action_key_hash_key`(`actor_person_id`, `action`, `key_hash`),
  INDEX `system_command_idempotencies_aggregate_type_aggregate_id_created_at_idx`(`aggregate_type`, `aggregate_id`, `created_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_service_configs` (
  `id` CHAR(36) NOT NULL, `capability` VARCHAR(100) NOT NULL, `provider` VARCHAR(100) NOT NULL, `model` VARCHAR(100) NOT NULL,
  `status` ENUM('DRAFT','TESTED','ACTIVE','DISABLED') NOT NULL DEFAULT 'DRAFT', `retention_policy` VARCHAR(100) NOT NULL,
  `max_retention_days` INTEGER UNSIGNED NULL, `training_opt_out` BOOLEAN NOT NULL DEFAULT true, `secret_ref` VARCHAR(191) NULL,
  `last_tested_at` DATETIME(3) NULL, `last_test_status` ENUM('NOT_TESTED','SUCCESS','FAILED') NOT NULL DEFAULT 'NOT_TESTED',
  `last_test_duration_ms` INTEGER UNSIGNED NULL, `last_test_error_category` VARCHAR(100) NULL, `last_verified_at` DATETIME(3) NULL,
  `evaluation_version` VARCHAR(100) NULL, `evaluation_passed_at` DATETIME(3) NULL, `version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `updated_by_person_id` CHAR(36) NOT NULL, `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `ai_service_configs_capability_key`(`capability`), INDEX `ai_service_configs_status_capability_idx`(`status`, `capability`),
  INDEX `ai_service_configs_updated_by_person_id_updated_at_idx`(`updated_by_person_id`, `updated_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ai_service_config_versions` (
  `id` CHAR(36) NOT NULL, `config_id` CHAR(36) NOT NULL, `version` INTEGER UNSIGNED NOT NULL, `before_json` JSON NULL,
  `after_json` JSON NOT NULL, `reason` VARCHAR(500) NOT NULL, `changed_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `ai_service_config_versions_config_id_version_key`(`config_id`, `version`),
  INDEX `ai_service_config_versions_changed_by_person_id_created_at_idx`(`changed_by_person_id`, `created_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `backup_records` (
  `id` CHAR(36) NOT NULL, `provider` VARCHAR(100) NOT NULL, `provider_backup_id` VARCHAR(191) NULL,
  `backup_type` ENUM('AUTO_INCREMENTAL','AUTO_FULL','PRE_RELEASE','PRE_MIGRATION','PRE_IMPORT','PRE_BATCH_SWITCH','MANUAL') NOT NULL,
  `source_environment` VARCHAR(100) NOT NULL, `status` ENUM('REQUESTED','RUNNING','SUCCEEDED','FAILED') NOT NULL DEFAULT 'REQUESTED',
  `snapshot_at` DATETIME(3) NULL, `schema_version` VARCHAR(191) NULL, `app_version` VARCHAR(100) NULL, `reason` VARCHAR(500) NOT NULL,
  `retention_until` DATETIME(3) NULL, `created_by_person_id` CHAR(36) NULL, `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL, `verified_at` DATETIME(3) NULL, `error_code` VARCHAR(100) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `backup_records_provider_provider_backup_id_key`(`provider`, `provider_backup_id`), INDEX `backup_records_status_requested_at_idx`(`status`, `requested_at`),
  INDEX `backup_records_backup_type_requested_at_idx`(`backup_type`, `requested_at`), INDEX `backup_records_created_by_person_id_requested_at_idx`(`created_by_person_id`, `requested_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `restore_requests` (
  `id` CHAR(36) NOT NULL, `backup_record_id` CHAR(36) NOT NULL,
  `status` ENUM('DRAFT','PREVIEWED','CONFIRMED','EXECUTING','PROVIDER_SUCCEEDED','VALIDATION_REQUIRED','SUCCEEDED','FAILED','CANCELED') NOT NULL DEFAULT 'DRAFT',
  `active_key` VARCHAR(32) NULL,
  `reason` VARCHAR(500) NOT NULL, `preview_version` INTEGER UNSIGNED NOT NULL DEFAULT 0, `preview_json` JSON NULL,
  `confirmation_hash` CHAR(64) NULL, `requested_by_person_id` CHAR(36) NOT NULL, `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `confirmed_at` DATETIME(3) NULL, `started_at` DATETIME(3) NULL, `finished_at` DATETIME(3) NULL,
  `provider_operation_id` VARCHAR(191) NULL, `error_code` VARCHAR(100) NULL, `validation_json` JSON NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `restore_requests_active_key_key`(`active_key`), INDEX `restore_requests_status_requested_at_idx`(`status`, `requested_at`), INDEX `restore_requests_backup_record_id_requested_at_idx`(`backup_record_id`, `requested_at`),
  INDEX `restore_requests_requested_by_person_id_requested_at_idx`(`requested_by_person_id`, `requested_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `system_maintenance_events` (
  `id` CHAR(36) NOT NULL, `event_type` ENUM('ENTER','EXIT') NOT NULL, `operation_id` VARCHAR(191) NOT NULL,
  `restore_id` CHAR(36) NULL, `actor_person_id` CHAR(36) NOT NULL, `reason` VARCHAR(500) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), INDEX `system_maintenance_events_operation_id_created_at_idx`(`operation_id`, `created_at`),
  INDEX `system_maintenance_events_restore_id_created_at_idx`(`restore_id`, `created_at`), INDEX `system_maintenance_events_actor_person_id_created_at_idx`(`actor_person_id`, `created_at`), PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `system_settings` ADD CONSTRAINT `system_settings_updated_by_person_id_fkey` FOREIGN KEY (`updated_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `system_setting_versions` ADD CONSTRAINT `system_setting_versions_setting_id_fkey` FOREIGN KEY (`setting_id`) REFERENCES `system_settings`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `system_setting_versions` ADD CONSTRAINT `system_setting_versions_changed_by_person_id_fkey` FOREIGN KEY (`changed_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `work_calendar_overrides` ADD CONSTRAINT `work_calendar_overrides_updated_by_person_id_fkey` FOREIGN KEY (`updated_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `system_command_idempotencies` ADD CONSTRAINT `system_command_idempotencies_actor_person_id_fkey` FOREIGN KEY (`actor_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ai_service_configs` ADD CONSTRAINT `ai_service_configs_updated_by_person_id_fkey` FOREIGN KEY (`updated_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ai_service_config_versions` ADD CONSTRAINT `ai_service_config_versions_config_id_fkey` FOREIGN KEY (`config_id`) REFERENCES `ai_service_configs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ai_service_config_versions` ADD CONSTRAINT `ai_service_config_versions_changed_by_person_id_fkey` FOREIGN KEY (`changed_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `backup_records` ADD CONSTRAINT `backup_records_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `restore_requests` ADD CONSTRAINT `restore_requests_backup_record_id_fkey` FOREIGN KEY (`backup_record_id`) REFERENCES `backup_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `restore_requests` ADD CONSTRAINT `restore_requests_requested_by_person_id_fkey` FOREIGN KEY (`requested_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `system_maintenance_events` ADD CONSTRAINT `system_maintenance_events_restore_id_fkey` FOREIGN KEY (`restore_id`) REFERENCES `restore_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `system_maintenance_events` ADD CONSTRAINT `system_maintenance_events_actor_person_id_fkey` FOREIGN KEY (`actor_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
