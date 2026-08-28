-- A-M1-007 is expand-only. Outcome plans capture the completion-time decision;
-- outcome rounds remain immutable after approval and only approved increments are reportable.

CREATE TABLE `demand_outcome_plans` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `tracking_mode` ENUM('NONE', 'TRACKING') NOT NULL,
  `status` ENUM('NOT_TRACKED', 'PENDING', 'IN_PROGRESS', 'ENDED') NOT NULL,
  `first_tracking_date` DATE NULL,
  `next_tracking_date` DATE NULL,
  `due_version` INT UNSIGNED NOT NULL DEFAULT 0,
  `ended_at` DATETIME(3) NULL,
  `decided_by_person_id` CHAR(36) NOT NULL,
  `decided_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `demand_outcome_plans_demand_key` (`demand_id`),
  INDEX `demand_outcome_plans_status_next_idx` (`status`, `next_tracking_date`),
  INDEX `demand_outcome_plans_decider_decided_idx` (`decided_by_person_id`, `decided_at`),
  CONSTRAINT `demand_outcome_plans_shape_check` CHECK (
    (`tracking_mode` = 'NONE' AND `status` = 'NOT_TRACKED' AND `first_tracking_date` IS NULL AND `next_tracking_date` IS NULL AND `due_version` = 0 AND `ended_at` IS NULL)
    OR
    (`tracking_mode` = 'TRACKING' AND `status` IN ('PENDING', 'IN_PROGRESS') AND `first_tracking_date` IS NOT NULL AND `next_tracking_date` IS NOT NULL AND `due_version` >= 1 AND `ended_at` IS NULL)
    OR
    (`tracking_mode` = 'TRACKING' AND `status` = 'ENDED' AND `first_tracking_date` IS NOT NULL AND `next_tracking_date` IS NULL AND `due_version` >= 1 AND `ended_at` IS NOT NULL)
  ),
  CONSTRAINT `demand_outcome_plans_demand_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_outcome_plans_decider_fkey`
    FOREIGN KEY (`decided_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `demand_outcome_rounds` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `outcome_plan_id` CHAR(36) NOT NULL,
  `round_no` INT UNSIGNED NOT NULL,
  `tracking_date` DATE NOT NULL,
  `tracking_batch_id` CHAR(36) NOT NULL,
  `contract_amount_increment` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `investment_amount_increment` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `policy_fund_increment` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `cost_reduction_increment` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `talent_introduced_increment` INT UNSIGNED NOT NULL DEFAULT 0,
  `patent_increment` INT UNSIGNED NOT NULL DEFAULT 0,
  `qualitative_result` TEXT NULL,
  `enterprise_feedback` TEXT NULL,
  `next_tracking_date` DATE NULL,
  `end_tracking` BOOLEAN NOT NULL,
  `review_status` ENUM('DRAFT', 'PENDING_REVIEW', 'RETURNED', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
  `created_by_person_id` CHAR(36) NOT NULL,
  `submitted_by_person_id` CHAR(36) NULL,
  `submitted_at` DATETIME(3) NULL,
  `reviewed_by_person_id` CHAR(36) NULL,
  `reviewed_at` DATETIME(3) NULL,
  `return_reason` VARCHAR(500) NULL,
  `verified_note` VARCHAR(2000) NULL,
  `edit_version` INT UNSIGNED NOT NULL DEFAULT 1,
  `active_key` TINYINT UNSIGNED NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `demand_outcome_rounds_round_key` (`demand_id`, `round_no`),
  UNIQUE INDEX `demand_outcome_rounds_active_key` (`demand_id`, `active_key`),
  INDEX `demand_outcome_rounds_demand_review_tracking_idx` (`demand_id`, `review_status`, `tracking_date`),
  INDEX `demand_outcome_rounds_batch_review_tracking_idx` (`tracking_batch_id`, `review_status`, `tracking_date`),
  INDEX `demand_outcome_rounds_plan_review_round_idx` (`outcome_plan_id`, `review_status`, `round_no`),
  INDEX `demand_outcome_rounds_creator_created_idx` (`created_by_person_id`, `created_at`),
  INDEX `demand_outcome_rounds_submitter_submitted_idx` (`submitted_by_person_id`, `submitted_at`),
  INDEX `demand_outcome_rounds_reviewer_reviewed_idx` (`reviewed_by_person_id`, `reviewed_at`),
  CONSTRAINT `demand_outcome_rounds_nonnegative_check` CHECK (
    `contract_amount_increment` >= 0 AND `investment_amount_increment` >= 0
    AND `policy_fund_increment` >= 0 AND `cost_reduction_increment` >= 0
    AND `talent_introduced_increment` >= 0 AND `patent_increment` >= 0
  ),
  CONSTRAINT `demand_outcome_rounds_schedule_check` CHECK (
    (`end_tracking` = TRUE AND `next_tracking_date` IS NULL)
    OR (`end_tracking` = FALSE AND `next_tracking_date` IS NOT NULL AND `next_tracking_date` > `tracking_date`)
  ),
  CONSTRAINT `demand_outcome_rounds_active_check` CHECK (
    (`review_status` = 'APPROVED' AND `active_key` IS NULL)
    OR (`review_status` IN ('DRAFT', 'PENDING_REVIEW', 'RETURNED') AND `active_key` = 1)
  ),
  CONSTRAINT `demand_outcome_rounds_demand_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_outcome_rounds_plan_fkey`
    FOREIGN KEY (`outcome_plan_id`) REFERENCES `demand_outcome_plans`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_outcome_rounds_batch_fkey`
    FOREIGN KEY (`tracking_batch_id`) REFERENCES `batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_outcome_rounds_creator_fkey`
    FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_outcome_rounds_submitter_fkey`
    FOREIGN KEY (`submitted_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `demand_outcome_rounds_reviewer_fkey`
    FOREIGN KEY (`reviewed_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
