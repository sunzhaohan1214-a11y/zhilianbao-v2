-- A-M1-006 is expand-only. Progress and close submissions are immutable
-- business facts; activeKey columns express current requests without partial
-- unique indexes on MySQL.

ALTER TABLE `demands`
  ADD COLUMN `completed_at` DATETIME(3) NULL,
  ADD COLUMN `completion_batch_id` CHAR(36) NULL,
  ADD COLUMN `canceled_at` DATETIME(3) NULL,
  ADD COLUMN `canceled_reason` VARCHAR(500) NULL,
  ADD INDEX `demands_completion_batch_completed_idx` (`completion_batch_id`, `completed_at`),
  ADD CONSTRAINT `demands_completion_batch_fkey`
    FOREIGN KEY (`completion_batch_id`) REFERENCES `batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `demand_progresses` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `current_progress` TEXT NOT NULL,
  `next_step` TEXT NOT NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `source_type` ENUM('CURRENT_OWNER', 'COLLABORATOR', 'ALUMNI_PLATFORM', 'TOWNSHIP_STAFF', 'TOWNSHIP_PROXY', 'ADMIN') NOT NULL,
  `represented_person_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `demand_progresses_demand_created_idx` (`demand_id`, `created_at`),
  INDEX `demand_progresses_creator_created_idx` (`created_by_person_id`, `created_at`),
  INDEX `demand_progresses_represented_created_idx` (`represented_person_id`, `created_at`),
  CONSTRAINT `demand_progresses_demand_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_progresses_creator_fkey`
    FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_progresses_represented_fkey`
    FOREIGN KEY (`represented_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `demand_progress_reminders` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `reminder_type` ENUM('PROGRESS_STALE') NOT NULL,
  `sent_by_person_id` CHAR(36) NOT NULL,
  `recipient_person_id` CHAR(36) NOT NULL,
  `responsibility_mode` ENUM('CURRENT_OWNER', 'ALUMNI_TOWNSHIP') NOT NULL,
  `sent_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `demand_progress_reminders_demand_type_sent_idx` (`demand_id`, `reminder_type`, `sent_at`),
  INDEX `demand_progress_reminders_recipient_sent_idx` (`recipient_person_id`, `sent_at`),
  CONSTRAINT `demand_progress_reminders_demand_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_progress_reminders_sender_fkey`
    FOREIGN KEY (`sent_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_progress_reminders_recipient_fkey`
    FOREIGN KEY (`recipient_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `demand_close_requests` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `submission_no` INT UNSIGNED NOT NULL,
  `solution` TEXT NOT NULL,
  `connected_resources` TEXT NOT NULL,
  `submitted_by_person_id` CHAR(36) NOT NULL,
  `responsibility_mode` ENUM('CURRENT_OWNER', 'ALUMNI_TOWNSHIP') NOT NULL,
  `township_handler_person_id` CHAR(36) NULL,
  `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `ended_at` DATETIME(3) NULL,
  `active_key` TINYINT UNSIGNED NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `demand_close_requests_submission_key` (`demand_id`, `submission_no`),
  UNIQUE INDEX `demand_close_requests_active_key` (`demand_id`, `active_key`),
  INDEX `demand_close_requests_demand_submitted_idx` (`demand_id`, `submitted_at`),
  INDEX `demand_close_requests_submitter_submitted_idx` (`submitted_by_person_id`, `submitted_at`),
  INDEX `demand_close_requests_handler_submitted_idx` (`township_handler_person_id`, `submitted_at`),
  CONSTRAINT `demand_close_requests_active_check` CHECK (
    (`active_key` = 1 AND `ended_at` IS NULL) OR (`active_key` IS NULL AND `ended_at` IS NOT NULL)
  ),
  CONSTRAINT `demand_close_requests_handler_check` CHECK (
    (`responsibility_mode` = 'CURRENT_OWNER' AND `township_handler_person_id` IS NULL)
    OR (`responsibility_mode` = 'ALUMNI_TOWNSHIP' AND `township_handler_person_id` IS NOT NULL)
  ),
  CONSTRAINT `demand_close_requests_demand_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_close_requests_submitter_fkey`
    FOREIGN KEY (`submitted_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_close_requests_handler_fkey`
    FOREIGN KEY (`township_handler_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `demand_close_reviews` (
  `id` CHAR(36) NOT NULL,
  `close_request_id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `decision` ENUM('APPROVE', 'RETURN') NOT NULL,
  `township_verification_result` TEXT NOT NULL,
  `reason` VARCHAR(500) NULL,
  `reviewed_by_person_id` CHAR(36) NOT NULL,
  `reviewed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `demand_close_reviews_request_key` (`close_request_id`),
  INDEX `demand_close_reviews_demand_reviewed_idx` (`demand_id`, `reviewed_at`),
  INDEX `demand_close_reviews_reviewer_reviewed_idx` (`reviewed_by_person_id`, `reviewed_at`),
  CONSTRAINT `demand_close_reviews_return_reason_check` CHECK (`decision` <> 'RETURN' OR `reason` IS NOT NULL),
  CONSTRAINT `demand_close_reviews_request_fkey`
    FOREIGN KEY (`close_request_id`) REFERENCES `demand_close_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_close_reviews_demand_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_close_reviews_reviewer_fkey`
    FOREIGN KEY (`reviewed_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `demand_owner_exit_requests` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `owner_person_id` CHAR(36) NOT NULL,
  `owner_history_id` CHAR(36) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `status` ENUM('PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'PENDING',
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewed_at` DATETIME(3) NULL,
  `reviewed_by_person_id` CHAR(36) NULL,
  `review_reason` VARCHAR(500) NULL,
  `active_key` TINYINT UNSIGNED NULL DEFAULT 1,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `demand_owner_exit_requests_active_key` (`demand_id`, `active_key`),
  INDEX `demand_owner_exit_requests_demand_status_requested_idx` (`demand_id`, `status`, `requested_at`),
  INDEX `demand_owner_exit_requests_owner_requested_idx` (`owner_person_id`, `requested_at`),
  INDEX `demand_owner_exit_requests_reviewer_reviewed_idx` (`reviewed_by_person_id`, `reviewed_at`),
  CONSTRAINT `demand_owner_exit_requests_active_check` CHECK (
    (`status` = 'PENDING' AND `active_key` = 1 AND `reviewed_at` IS NULL AND `reviewed_by_person_id` IS NULL)
    OR (`status` IN ('APPROVED', 'REJECTED') AND `active_key` IS NULL AND `reviewed_at` IS NOT NULL AND `reviewed_by_person_id` IS NOT NULL)
  ),
  CONSTRAINT `demand_owner_exit_requests_demand_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_owner_exit_requests_owner_fkey`
    FOREIGN KEY (`owner_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_owner_exit_requests_history_fkey`
    FOREIGN KEY (`owner_history_id`) REFERENCES `demand_owner_histories`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_owner_exit_requests_reviewer_fkey`
    FOREIGN KEY (`reviewed_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
