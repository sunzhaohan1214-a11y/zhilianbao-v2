-- C-M3-002 Help is expand-only. It adds the private help workflow,
-- append-only assignment/progress history and command idempotency.

CREATE TABLE `help_requests` (
  `id` CHAR(36) NOT NULL,
  `business_no` VARCHAR(32) NOT NULL,
  `submitter_person_id` CHAR(36) NOT NULL,
  `category` ENUM('ACCOMMODATION', 'TRANSPORTATION', 'DINING', 'WORK', 'LIFE', 'OTHER') NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` TEXT NOT NULL,
  `urgency` ENUM('NORMAL', 'URGENT') NOT NULL DEFAULT 'NORMAL',
  `status` ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
  `current_owner_person_id` CHAR(36) NULL,
  `transferred_organization_id` CHAR(36) NULL,
  `expected_complete_at` DATETIME(3) NULL,
  `completed_at` DATETIME(3) NULL,
  `completion_summary` VARCHAR(5000) NULL,
  `withdrawn_at` DATETIME(3) NULL,
  `withdraw_reason` VARCHAR(500) NULL,
  `reopened_at` DATETIME(3) NULL,
  `reopen_reason` VARCHAR(500) NULL,
  `source_system` VARCHAR(50) NOT NULL DEFAULT 'V2',
  `source_record_id` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `help_requests_business_no_key` (`business_no`),
  UNIQUE INDEX `help_requests_source_system_source_record_id_key` (`source_system`, `source_record_id`),
  INDEX `help_requests_submitter_person_id_created_at_idx` (`submitter_person_id`, `created_at`),
  INDEX `help_requests_current_owner_person_id_status_updated_at_idx` (`current_owner_person_id`, `status`, `updated_at`),
  INDEX `help_requests_transferred_organization_id_status_created_at_idx` (`transferred_organization_id`, `status`, `created_at`),
  INDEX `help_requests_status_expected_complete_at_idx` (`status`, `expected_complete_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `help_requests_state_shape_check` CHECK (
    (`status` = 'PENDING' AND `current_owner_person_id` IS NULL AND `completed_at` IS NULL AND `withdrawn_at` IS NULL)
    OR (`status` = 'IN_PROGRESS' AND `current_owner_person_id` IS NOT NULL AND `expected_complete_at` IS NOT NULL AND `completed_at` IS NULL AND `withdrawn_at` IS NULL)
    OR (`status` = 'COMPLETED' AND `current_owner_person_id` IS NOT NULL AND `expected_complete_at` IS NOT NULL AND `completed_at` IS NOT NULL AND `completion_summary` IS NOT NULL AND `withdrawn_at` IS NULL)
    OR (`status` = 'WITHDRAWN' AND `current_owner_person_id` IS NULL AND `withdrawn_at` IS NOT NULL AND `withdraw_reason` IS NOT NULL)
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `help_assignment_history` (
  `id` CHAR(36) NOT NULL,
  `help_request_id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NULL,
  `organization_id` CHAR(36) NULL,
  `assignment_type` ENUM('DIRECT_PERSON', 'ORGANIZATION_TRANSFER', 'CLAIM', 'REASSIGN') NOT NULL,
  `effective_at` DATETIME(3) NOT NULL,
  `expired_at` DATETIME(3) NULL,
  `active_key` TINYINT UNSIGNED NULL DEFAULT 1,
  `reason` VARCHAR(500) NULL,
  `changed_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `help_assignment_history_help_request_id_active_key_key` (`help_request_id`, `active_key`),
  INDEX `help_assignment_history_help_request_id_effective_at_expired_at_idx` (`help_request_id`, `effective_at`, `expired_at`),
  INDEX `help_assignment_history_person_id_effective_at_expired_at_idx` (`person_id`, `effective_at`, `expired_at`),
  INDEX `help_assignment_history_organization_id_effective_at_expired_at_idx` (`organization_id`, `effective_at`, `expired_at`),
  INDEX `help_assignment_history_changed_by_person_id_created_at_idx` (`changed_by_person_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `help_assignment_target_check` CHECK (
    (`person_id` IS NOT NULL AND `organization_id` IS NULL AND `assignment_type` IN ('DIRECT_PERSON', 'CLAIM', 'REASSIGN'))
    OR (`person_id` IS NULL AND `organization_id` IS NOT NULL AND `assignment_type` = 'ORGANIZATION_TRANSFER')
  ),
  CONSTRAINT `help_assignment_active_check` CHECK (
    (`active_key` = 1 AND `expired_at` IS NULL) OR (`active_key` IS NULL AND `expired_at` IS NOT NULL)
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `help_progresses` (
  `id` CHAR(36) NOT NULL,
  `help_request_id` CHAR(36) NOT NULL,
  `content` VARCHAR(5000) NOT NULL,
  `next_step` VARCHAR(2000) NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `help_progresses_help_request_id_created_at_idx` (`help_request_id`, `created_at`),
  INDEX `help_progresses_created_by_person_id_created_at_idx` (`created_by_person_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `help_command_idempotencies` (
  `id` CHAR(36) NOT NULL,
  `help_request_id` CHAR(36) NOT NULL,
  `actor_person_id` CHAR(36) NOT NULL,
  `action_code` VARCHAR(100) NOT NULL,
  `idempotency_key_hash` CHAR(64) NOT NULL,
  `payload_hash` CHAR(64) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `help_command_idempotencies_actor_person_id_action_code_idempotency_key_hash_key` (`actor_person_id`, `action_code`, `idempotency_key_hash`),
  INDEX `help_command_idempotencies_help_request_id_created_at_idx` (`help_request_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `help_requests` ADD CONSTRAINT `help_requests_submitter_person_id_fkey` FOREIGN KEY (`submitter_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `help_requests` ADD CONSTRAINT `help_requests_current_owner_person_id_fkey` FOREIGN KEY (`current_owner_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `help_requests` ADD CONSTRAINT `help_requests_transferred_organization_id_fkey` FOREIGN KEY (`transferred_organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `help_assignment_history` ADD CONSTRAINT `help_assignment_history_help_request_id_fkey` FOREIGN KEY (`help_request_id`) REFERENCES `help_requests` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `help_assignment_history` ADD CONSTRAINT `help_assignment_history_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `help_assignment_history` ADD CONSTRAINT `help_assignment_history_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `help_assignment_history` ADD CONSTRAINT `help_assignment_history_changed_by_person_id_fkey` FOREIGN KEY (`changed_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `help_progresses` ADD CONSTRAINT `help_progresses_help_request_id_fkey` FOREIGN KEY (`help_request_id`) REFERENCES `help_requests` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `help_progresses` ADD CONSTRAINT `help_progresses_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `help_command_idempotencies` ADD CONSTRAINT `help_command_idempotencies_help_request_id_fkey` FOREIGN KEY (`help_request_id`) REFERENCES `help_requests` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `help_command_idempotencies` ADD CONSTRAINT `help_command_idempotencies_actor_person_id_fkey` FOREIGN KEY (`actor_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
