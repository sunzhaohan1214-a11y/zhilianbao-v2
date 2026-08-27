-- M1-005 is expand-only. Recommendation runs and immutable item snapshots are
-- separate from demand ownership; alumni responsibility has dedicated helper
-- and township-handler relationships.

CREATE TABLE `demand_recommendation_runs` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `stage` ENUM('CURRENT', 'ALUMNI') NOT NULL,
  `status` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FALLBACK_SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `trigger_type` ENUM('AUTO', 'ADMIN') NOT NULL,
  `rules_version` VARCHAR(100) NOT NULL,
  `prompt_version` VARCHAR(100) NULL,
  `provider` VARCHAR(100) NULL,
  `model` VARCHAR(100) NULL,
  `candidate_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `current_key` TINYINT UNSIGNED NULL,
  `started_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `duration_ms` INT UNSIGNED NULL,
  `error_category` VARCHAR(100) NULL,
  `created_by_person_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  CONSTRAINT `demand_recommendation_runs_current_key_check` CHECK (`current_key` IS NULL OR `current_key` = 1),
  UNIQUE INDEX `demand_recommendation_runs_demand_stage_current_key` (`demand_id`, `stage`, `current_key`),
  INDEX `demand_recommendation_runs_demand_stage_created_idx` (`demand_id`, `stage`, `created_at`),
  INDEX `demand_recommendation_runs_status_created_at_idx` (`status`, `created_at`),
  INDEX `demand_recommendation_runs_creator_created_at_idx` (`created_by_person_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `demand_recommendation_items` (
  `id` CHAR(36) NOT NULL,
  `run_id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `candidate_kind` ENUM('CURRENT', 'ALUMNI_PLATFORM', 'ALUMNI_HISTORICAL') NOT NULL,
  `rank` TINYINT UNSIGNED NOT NULL,
  `source` ENUM('AI', 'RULE_FALLBACK', 'MANUAL') NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `evidence_snapshot_json` JSON NOT NULL,
  `response_status` ENUM('WILLING', 'DECLINE') NULL,
  `responded_at` DATETIME(3) NULL,
  `responded_by_person_id` CHAR(36) NULL,
  `response_note` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  CONSTRAINT `demand_recommendation_items_rank_check` CHECK (`rank` BETWEEN 1 AND 3),
  CONSTRAINT `demand_recommendation_items_response_check` CHECK (
    (`response_status` IS NULL AND `responded_at` IS NULL)
    OR (`response_status` IS NOT NULL AND `responded_at` IS NOT NULL)
  ),
  UNIQUE INDEX `demand_recommendation_items_run_id_rank_key` (`run_id`, `rank`),
  UNIQUE INDEX `demand_recommendation_items_run_id_person_id_key` (`run_id`, `person_id`),
  INDEX `demand_recommendation_items_person_response_created_idx` (`person_id`, `response_status`, `created_at`),
  INDEX `demand_recommendation_items_responder_responded_idx` (`responded_by_person_id`, `responded_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `demand_alumni_helpers` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `helper_kind` ENUM('PLATFORM', 'HISTORICAL') NOT NULL,
  `source_recommendation_item_id` CHAR(36) NULL,
  `effective_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expired_at` DATETIME(3) NULL,
  `status` ENUM('ACTIVE', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
  `active_key` TINYINT UNSIGNED NULL DEFAULT 1,
  `created_by_person_id` CHAR(36) NOT NULL,
  `reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  CONSTRAINT `demand_alumni_helpers_active_check` CHECK (
    (`status` = 'ACTIVE' AND `active_key` = 1 AND `expired_at` IS NULL)
    OR (`status` = 'ENDED' AND `active_key` IS NULL AND `expired_at` IS NOT NULL)
  ),
  UNIQUE INDEX `demand_alumni_helpers_source_item_id_key` (`source_recommendation_item_id`),
  UNIQUE INDEX `demand_alumni_helpers_demand_person_active_key` (`demand_id`, `person_id`, `active_key`),
  INDEX `demand_alumni_helpers_demand_status_effective_idx` (`demand_id`, `status`, `effective_at`),
  INDEX `demand_alumni_helpers_person_status_effective_idx` (`person_id`, `status`, `effective_at`),
  INDEX `demand_alumni_helpers_creator_created_at_idx` (`created_by_person_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `demand_township_handlers` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `organization_id` CHAR(36) NOT NULL,
  `effective_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expired_at` DATETIME(3) NULL,
  `active_key` TINYINT UNSIGNED NULL DEFAULT 1,
  `assigned_by_person_id` CHAR(36) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  CONSTRAINT `demand_township_handlers_active_check` CHECK (
    (`active_key` = 1 AND `expired_at` IS NULL)
    OR (`active_key` IS NULL AND `expired_at` IS NOT NULL)
  ),
  UNIQUE INDEX `demand_township_handlers_demand_active_key` (`demand_id`, `active_key`),
  INDEX `demand_township_handlers_person_period_idx` (`person_id`, `effective_at`, `expired_at`),
  INDEX `demand_township_handlers_org_period_idx` (`organization_id`, `effective_at`, `expired_at`),
  INDEX `demand_township_handlers_assigner_created_idx` (`assigned_by_person_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `demand_recommendation_runs`
  ADD CONSTRAINT `demand_recommendation_runs_demand_id_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_recommendation_runs_creator_fkey`
    FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `demand_recommendation_items`
  ADD CONSTRAINT `demand_recommendation_items_run_id_fkey`
    FOREIGN KEY (`run_id`) REFERENCES `demand_recommendation_runs`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_recommendation_items_person_id_fkey`
    FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_recommendation_items_responder_fkey`
    FOREIGN KEY (`responded_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `demand_alumni_helpers`
  ADD CONSTRAINT `demand_alumni_helpers_demand_id_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_alumni_helpers_person_id_fkey`
    FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_alumni_helpers_source_item_fkey`
    FOREIGN KEY (`source_recommendation_item_id`) REFERENCES `demand_recommendation_items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_alumni_helpers_creator_fkey`
    FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `demand_township_handlers`
  ADD CONSTRAINT `demand_township_handlers_demand_id_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_township_handlers_person_id_fkey`
    FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_township_handlers_org_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_township_handlers_assigner_fkey`
    FOREIGN KEY (`assigned_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
