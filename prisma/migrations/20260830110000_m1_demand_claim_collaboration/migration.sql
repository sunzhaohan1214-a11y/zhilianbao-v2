-- M1-004 is expand-only: keep the existing demand aggregate and add current
-- ownership plus append-only ownership/collaboration history.
ALTER TABLE `demands`
  ADD COLUMN `current_owner_person_id` CHAR(36) NULL,
  ADD INDEX `demands_current_owner_person_id_status_idx` (`current_owner_person_id`, `status`),
  ADD CONSTRAINT `demands_current_owner_person_id_fkey`
    FOREIGN KEY (`current_owner_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `demand_owner_histories` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `batch_id` CHAR(36) NOT NULL,
  `effective_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expired_at` DATETIME(3) NULL,
  `reason` VARCHAR(500) NULL,
  `change_type` ENUM('CLAIM', 'TRANSFER', 'OWNER_EXIT_APPROVED', 'CROSS_BATCH_TRANSFER') NOT NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `active_key` TINYINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  CONSTRAINT `demand_owner_histories_active_key_check` CHECK (
    (`active_key` = 1 AND `expired_at` IS NULL)
    OR (`active_key` IS NULL AND `expired_at` IS NOT NULL)
  ),
  UNIQUE INDEX `demand_owner_histories_demand_id_active_key_key` (`demand_id`, `active_key`),
  INDEX `demand_owner_histories_person_id_effective_at_expired_at_idx` (`person_id`, `effective_at`, `expired_at`),
  INDEX `demand_owner_histories_batch_id_effective_at_expired_at_idx` (`batch_id`, `effective_at`, `expired_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `demand_collaboration_requests` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `request_type` ENUM('APPLY', 'INVITE') NOT NULL,
  `status` ENUM('PENDING', 'ACCEPTED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'PENDING',
  `requested_by_person_id` CHAR(36) NOT NULL,
  `decided_by_person_id` CHAR(36) NULL,
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `decided_at` DATETIME(3) NULL,
  `pending_key` TINYINT UNSIGNED NULL,

  CONSTRAINT `demand_collaboration_requests_pending_key_check` CHECK (
    (`status` = 'PENDING' AND `pending_key` = 1 AND `decided_at` IS NULL)
    OR (`status` <> 'PENDING' AND `pending_key` IS NULL AND `decided_at` IS NOT NULL)
  ),
  UNIQUE INDEX `demand_collab_requests_demand_person_pending_key` (`demand_id`, `person_id`, `pending_key`),
  INDEX `demand_collab_requests_demand_status_requested_idx` (`demand_id`, `status`, `requested_at`),
  INDEX `demand_collab_requests_person_status_requested_idx` (`person_id`, `status`, `requested_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `demand_collaborators` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `source_request_id` CHAR(36) NULL,
  `source_type` ENUM('APPLY', 'INVITE') NOT NULL,
  `status` ENUM('ACTIVE', 'LEFT', 'REMOVED') NOT NULL DEFAULT 'ACTIVE',
  `effective_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expired_at` DATETIME(3) NULL,
  `ended_reason` VARCHAR(500) NULL,
  `ended_by_person_id` CHAR(36) NULL,
  `active_key` TINYINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  CONSTRAINT `demand_collaborators_active_key_check` CHECK (
    (`status` = 'ACTIVE' AND `active_key` = 1 AND `expired_at` IS NULL AND `ended_by_person_id` IS NULL)
    OR (`status` <> 'ACTIVE' AND `active_key` IS NULL AND `expired_at` IS NOT NULL AND `ended_by_person_id` IS NOT NULL)
  ),
  UNIQUE INDEX `demand_collaborators_source_request_id_key` (`source_request_id`),
  UNIQUE INDEX `demand_collaborators_demand_person_active_key` (`demand_id`, `person_id`, `active_key`),
  INDEX `demand_collaborators_demand_status_effective_idx` (`demand_id`, `status`, `effective_at`),
  INDEX `demand_collaborators_person_status_effective_idx` (`person_id`, `status`, `effective_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `demand_owner_histories`
  ADD CONSTRAINT `demand_owner_histories_demand_id_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_owner_histories_person_id_fkey`
    FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_owner_histories_batch_id_fkey`
    FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_owner_histories_created_by_fkey`
    FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `demand_collaboration_requests`
  ADD CONSTRAINT `demand_collab_requests_demand_id_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_collab_requests_person_id_fkey`
    FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_collab_requests_requested_by_fkey`
    FOREIGN KEY (`requested_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_collab_requests_decided_by_fkey`
    FOREIGN KEY (`decided_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `demand_collaborators`
  ADD CONSTRAINT `demand_collaborators_demand_id_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_collaborators_person_id_fkey`
    FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_collaborators_source_request_id_fkey`
    FOREIGN KEY (`source_request_id`) REFERENCES `demand_collaboration_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_collaborators_ended_by_person_id_fkey`
    FOREIGN KEY (`ended_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
