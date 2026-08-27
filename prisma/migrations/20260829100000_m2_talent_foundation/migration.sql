-- C-M2-005 Talent is expand-only. It introduces external talent resources,
-- immutable versions/contact history and independent township contact rounds.

CREATE TABLE `talents` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `scope_type` ENUM('DOMESTIC', 'OVERSEAS') NOT NULL,
  `organization_name` VARCHAR(200) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `professional_direction` VARCHAR(1000) NOT NULL,
  `work_education_experience` TEXT NULL,
  `representative_achievements` TEXT NULL,
  `original_recommender_person_id` CHAR(36) NOT NULL,
  `current_contact_person_id` CHAR(36) NOT NULL,
  `status` ENUM('ACTIVE', 'DISABLED', 'MERGED') NOT NULL DEFAULT 'ACTIVE',
  `merged_into_id` CHAR(36) NULL,
  `current_version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `source_system` VARCHAR(50) NOT NULL DEFAULT 'V2',
  `source_record_id` VARCHAR(191) NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `talents_source_system_source_record_id_key` (`source_system`, `source_record_id`),
  INDEX `talents_status_scope_type_updated_at_idx` (`status`, `scope_type`, `updated_at`),
  INDEX `talents_name_idx` (`name`),
  INDEX `talents_organization_name_idx` (`organization_name`),
  INDEX `talents_original_recommender_person_id_idx` (`original_recommender_person_id`),
  INDEX `talents_current_contact_person_id_idx` (`current_contact_person_id`),
  INDEX `talents_merged_into_id_idx` (`merged_into_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `talents_merge_state_check` CHECK ((`status` = 'MERGED' AND `merged_into_id` IS NOT NULL) OR (`status` <> 'MERGED' AND `merged_into_id` IS NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `talent_change_requests` (
  `id` CHAR(36) NOT NULL,
  `request_type` ENUM('CREATE', 'CORRECTION') NOT NULL,
  `status` ENUM('PENDING_REVIEW', 'APPROVED', 'RETURNED', 'CLOSED') NOT NULL DEFAULT 'PENDING_REVIEW',
  `target_talent_id` CHAR(36) NULL,
  `base_talent_version` INTEGER UNSIGNED NULL,
  `payload_snapshot` JSON NOT NULL,
  `submitter_person_id` CHAR(36) NOT NULL,
  `reviewer_person_id` CHAR(36) NULL,
  `review_reason` VARCHAR(500) NULL,
  `approved_talent_id` CHAR(36) NULL,
  `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `talent_change_requests_status_created_at_idx` (`status`, `created_at`),
  INDEX `talent_change_requests_submitter_person_id_status_idx` (`submitter_person_id`, `status`),
  INDEX `talent_change_requests_target_talent_id_idx` (`target_talent_id`),
  INDEX `talent_change_requests_approved_talent_id_idx` (`approved_talent_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `talent_change_requests_shape_check` CHECK ((`request_type` = 'CREATE' AND `target_talent_id` IS NULL AND `base_talent_version` IS NULL) OR (`request_type` = 'CORRECTION' AND `target_talent_id` IS NOT NULL AND `base_talent_version` IS NOT NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `talent_versions` (
  `id` CHAR(36) NOT NULL,
  `talent_id` CHAR(36) NOT NULL,
  `version_no` INTEGER UNSIGNED NOT NULL,
  `snapshot_json` JSON NOT NULL,
  `change_type` ENUM('CREATE', 'CHANGE_REQUEST_APPROVED', 'FORMAL_CORRECTION', 'CONTACT_PERSON_CHANGED', 'DISABLE', 'MERGE') NOT NULL,
  `reason` VARCHAR(500) NULL,
  `changed_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `talent_versions_talent_id_version_no_key` (`talent_id`, `version_no`),
  INDEX `talent_versions_changed_by_person_id_created_at_idx` (`changed_by_person_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `talent_contact_person_history` (
  `id` CHAR(36) NOT NULL,
  `talent_id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `effective_at` DATETIME(3) NOT NULL,
  `expired_at` DATETIME(3) NULL,
  `active_key` TINYINT UNSIGNED NULL DEFAULT 1,
  `change_reason` VARCHAR(500) NULL,
  `changed_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `talent_contact_person_history_talent_id_active_key_key` (`talent_id`, `active_key`),
  INDEX `talent_contact_history_person_period_idx` (`person_id`, `effective_at`, `expired_at`),
  INDEX `talent_contact_history_changer_created_idx` (`changed_by_person_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `talent_contact_history_active_check` CHECK ((`active_key` = 1 AND `expired_at` IS NULL) OR (`active_key` IS NULL AND `expired_at` IS NOT NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `talent_township_rounds` (
  `id` CHAR(36) NOT NULL,
  `talent_id` CHAR(36) NOT NULL,
  `area_id` CHAR(36) NOT NULL,
  `round_no` INTEGER UNSIGNED NOT NULL,
  `status` ENUM('IN_PROGRESS', 'COMPLETED', 'WITHDRAWN') NOT NULL DEFAULT 'IN_PROGRESS',
  `active_key` TINYINT UNSIGNED NULL DEFAULT 1,
  `started_by_person_id` CHAR(36) NOT NULL,
  `current_handler_person_id` CHAR(36) NOT NULL,
  `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  `withdrawn_at` DATETIME(3) NULL,
  `result_summary` VARCHAR(2000) NULL,
  `withdraw_reason` VARCHAR(500) NULL,
  `voided_at` DATETIME(3) NULL,
  `voided_by_person_id` CHAR(36) NULL,
  `void_reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `talent_township_rounds_talent_id_area_id_round_no_key` (`talent_id`, `area_id`, `round_no`),
  UNIQUE INDEX `talent_township_rounds_talent_id_area_id_active_key_key` (`talent_id`, `area_id`, `active_key`),
  INDEX `talent_township_rounds_talent_id_status_voided_at_idx` (`talent_id`, `status`, `voided_at`),
  INDEX `talent_township_rounds_area_id_status_voided_at_idx` (`area_id`, `status`, `voided_at`),
  INDEX `talent_township_rounds_current_handler_person_id_status_idx` (`current_handler_person_id`, `status`),
  PRIMARY KEY (`id`),
  CONSTRAINT `talent_round_terminal_check` CHECK ((`status` = 'IN_PROGRESS' AND `active_key` = 1 AND `completed_at` IS NULL AND `withdrawn_at` IS NULL) OR (`status` = 'COMPLETED' AND `active_key` IS NULL AND `completed_at` IS NOT NULL AND `withdrawn_at` IS NULL) OR (`status` = 'WITHDRAWN' AND `active_key` IS NULL AND `completed_at` IS NULL AND `withdrawn_at` IS NOT NULL) OR (`voided_at` IS NOT NULL AND `active_key` IS NULL)),
  CONSTRAINT `talent_round_void_check` CHECK ((`voided_at` IS NULL AND `voided_by_person_id` IS NULL AND `void_reason` IS NULL) OR (`voided_at` IS NOT NULL AND `voided_by_person_id` IS NOT NULL AND `void_reason` IS NOT NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `talent_township_progresses` (
  `id` CHAR(36) NOT NULL,
  `round_id` CHAR(36) NOT NULL,
  `content` VARCHAR(2000) NOT NULL,
  `next_step` VARCHAR(1000) NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `talent_township_progresses_round_id_created_at_idx` (`round_id`, `created_at`),
  INDEX `talent_progress_creator_created_idx` (`created_by_person_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `talent_ai_extractions` (
  `id` CHAR(36) NOT NULL,
  `request_id` CHAR(36) NOT NULL,
  `attachment_id` CHAR(36) NOT NULL,
  `status` ENUM('PENDING', 'COMPLETED', 'FAILED', 'CONFIRMED') NOT NULL DEFAULT 'PENDING',
  `candidate_json` JSON NULL,
  `evidence_json` JSON NULL,
  `provider` VARCHAR(100) NOT NULL,
  `model` VARCHAR(100) NOT NULL,
  `prompt_version` VARCHAR(100) NOT NULL,
  `failure_code` VARCHAR(100) NULL,
  `requested_by_person_id` CHAR(36) NOT NULL,
  `confirmed_by_person_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `confirmed_at` DATETIME(3) NULL,
  INDEX `talent_ai_extractions_request_id_created_at_idx` (`request_id`, `created_at`),
  INDEX `talent_ai_extractions_attachment_id_idx` (`attachment_id`),
  INDEX `talent_ai_extractions_status_created_at_idx` (`status`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `talents` ADD CONSTRAINT `talents_original_recommender_person_id_fkey` FOREIGN KEY (`original_recommender_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talents` ADD CONSTRAINT `talents_current_contact_person_id_fkey` FOREIGN KEY (`current_contact_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talents` ADD CONSTRAINT `talents_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talents` ADD CONSTRAINT `talents_merged_into_id_fkey` FOREIGN KEY (`merged_into_id`) REFERENCES `talents` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `talent_change_requests` ADD CONSTRAINT `talent_change_requests_target_talent_id_fkey` FOREIGN KEY (`target_talent_id`) REFERENCES `talents` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `talent_change_requests` ADD CONSTRAINT `talent_change_requests_approved_talent_id_fkey` FOREIGN KEY (`approved_talent_id`) REFERENCES `talents` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_change_requests` ADD CONSTRAINT `talent_change_requests_submitter_person_id_fkey` FOREIGN KEY (`submitter_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_change_requests` ADD CONSTRAINT `talent_change_requests_reviewer_person_id_fkey` FOREIGN KEY (`reviewer_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_versions` ADD CONSTRAINT `talent_versions_talent_id_fkey` FOREIGN KEY (`talent_id`) REFERENCES `talents` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_versions` ADD CONSTRAINT `talent_versions_changed_by_person_id_fkey` FOREIGN KEY (`changed_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_contact_person_history` ADD CONSTRAINT `talent_contact_person_history_talent_id_fkey` FOREIGN KEY (`talent_id`) REFERENCES `talents` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_contact_person_history` ADD CONSTRAINT `talent_contact_person_history_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_contact_person_history` ADD CONSTRAINT `talent_contact_person_history_changed_by_person_id_fkey` FOREIGN KEY (`changed_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_township_rounds` ADD CONSTRAINT `talent_township_rounds_talent_id_fkey` FOREIGN KEY (`talent_id`) REFERENCES `talents` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_township_rounds` ADD CONSTRAINT `talent_township_rounds_area_id_fkey` FOREIGN KEY (`area_id`) REFERENCES `administrative_areas` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_township_rounds` ADD CONSTRAINT `talent_township_rounds_started_by_person_id_fkey` FOREIGN KEY (`started_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_township_rounds` ADD CONSTRAINT `talent_township_rounds_current_handler_person_id_fkey` FOREIGN KEY (`current_handler_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_township_rounds` ADD CONSTRAINT `talent_township_rounds_voided_by_person_id_fkey` FOREIGN KEY (`voided_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `talent_township_progresses` ADD CONSTRAINT `talent_township_progresses_round_id_fkey` FOREIGN KEY (`round_id`) REFERENCES `talent_township_rounds` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_township_progresses` ADD CONSTRAINT `talent_township_progresses_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_ai_extractions` ADD CONSTRAINT `talent_ai_extractions_request_id_fkey` FOREIGN KEY (`request_id`) REFERENCES `talent_change_requests` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_ai_extractions` ADD CONSTRAINT `talent_ai_extractions_attachment_id_fkey` FOREIGN KEY (`attachment_id`) REFERENCES `attachments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_ai_extractions` ADD CONSTRAINT `talent_ai_extractions_requested_by_person_id_fkey` FOREIGN KEY (`requested_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `talent_ai_extractions` ADD CONSTRAINT `talent_ai_extractions_confirmed_by_person_id_fkey` FOREIGN KEY (`confirmed_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
