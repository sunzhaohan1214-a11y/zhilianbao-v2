-- M3-003 expand-only foundation for announcements, personal messages and executable todos.
CREATE TABLE `announcements` (
  `id` CHAR(36) NOT NULL,
  `status` ENUM('DRAFT','PUBLISHED','WITHDRAWN') NOT NULL DEFAULT 'DRAFT',
  `current_version_id` CHAR(36) NULL,
  `is_pinned` BOOLEAN NOT NULL DEFAULT false,
  `pinned_key` TINYINT UNSIGNED NULL,
  `published_at` DATETIME(3) NULL,
  `published_by_person_id` CHAR(36) NULL,
  `withdrawn_at` DATETIME(3) NULL,
  `withdrawn_by_person_id` CHAR(36) NULL,
  `withdraw_reason` VARCHAR(500) NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `announcements_current_version_id_key`(`current_version_id`),
  UNIQUE INDEX `announcements_pinned_key_key`(`pinned_key`),
  INDEX `announcements_status_is_pinned_published_at_idx`(`status`,`is_pinned`,`published_at`),
  INDEX `announcements_created_by_person_id_created_at_idx`(`created_by_person_id`,`created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `announcement_versions` (
  `id` CHAR(36) NOT NULL,
  `announcement_id` CHAR(36) NOT NULL,
  `version_no` INT UNSIGNED NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `body` TEXT NOT NULL,
  `is_important` BOOLEAN NOT NULL DEFAULT false,
  `need_confirm` BOOLEAN NOT NULL DEFAULT false,
  `reason` VARCHAR(500) NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `announcement_versions_announcement_id_version_no_key`(`announcement_id`,`version_no`),
  INDEX `announcement_versions_created_by_person_id_created_at_idx`(`created_by_person_id`,`created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `announcement_audience_rules` (
  `id` CHAR(36) NOT NULL,
  `announcement_id` CHAR(36) NOT NULL,
  `audience_type` ENUM('ALL','ROLE','ADMINISTRATIVE_AREA','ORGANIZATION','PERSON') NOT NULL,
  `role_code` ENUM('MEMBER_CURRENT','MEMBER_ALUMNI_PLATFORM','GROUP_LEADER','MINISTER','TOWNSHIP_STAFF','DEPARTMENT_STAFF','ADMIN','SUPER_ADMIN','LEADER_STAGE2') NULL,
  `area_id` CHAR(36) NULL,
  `organization_id` CHAR(36) NULL,
  `person_id` CHAR(36) NULL,
  `effective_at` DATETIME(3) NOT NULL,
  `expired_at` DATETIME(3) NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `announcement_audience_rules_announcement_period_idx`(`announcement_id`,`effective_at`,`expired_at`),
  INDEX `announcement_audience_rules_target_idx`(`audience_type`,`role_code`,`area_id`,`organization_id`,`person_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `announcement_recipient_states` (
  `id` CHAR(36) NOT NULL,
  `version_id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `read_at` DATETIME(3) NULL,
  `confirmed_at` DATETIME(3) NULL,
  `revoked_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `announcement_recipient_states_version_id_person_id_key`(`version_id`,`person_id`),
  INDEX `announcement_recipient_states_person_access_confirm_idx`(`person_id`,`revoked_at`,`confirmed_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `messages` (
  `id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `message_type` VARCHAR(100) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `summary` VARCHAR(500) NOT NULL,
  `aggregate_type` VARCHAR(100) NULL,
  `aggregate_id` CHAR(36) NULL,
  `action_url` VARCHAR(500) NULL,
  `dedupe_key` VARCHAR(191) NOT NULL,
  `event_at` DATETIME(3) NOT NULL,
  `read_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `messages_dedupe_key_key`(`dedupe_key`),
  INDEX `messages_person_id_read_at_event_at_idx`(`person_id`,`read_at`,`event_at`),
  INDEX `messages_aggregate_type_aggregate_id_idx`(`aggregate_type`,`aggregate_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `todos` (
  `id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `todo_type` VARCHAR(100) NOT NULL,
  `module` VARCHAR(100) NOT NULL,
  `aggregate_type` VARCHAR(100) NOT NULL,
  `aggregate_id` CHAR(36) NOT NULL,
  `action_url` VARCHAR(500) NOT NULL,
  `dedupe_key` VARCHAR(191) NOT NULL,
  `event_key` VARCHAR(191) NULL,
  `status` ENUM('OPEN','COMPLETED','STALE') NOT NULL DEFAULT 'OPEN',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `completed_at` DATETIME(3) NULL,
  `stale_at` DATETIME(3) NULL,
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `todos_dedupe_key_key`(`dedupe_key`),
  INDEX `todos_person_id_status_module_created_at_idx`(`person_id`,`status`,`module`,`created_at`),
  INDEX `todos_aggregate_type_aggregate_id_status_idx`(`aggregate_type`,`aggregate_id`,`status`),
  INDEX `todos_event_key_idx`(`event_key`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `announcements` ADD CONSTRAINT `announcements_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `announcements` ADD CONSTRAINT `announcements_published_by_person_id_fkey` FOREIGN KEY (`published_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `announcements` ADD CONSTRAINT `announcements_withdrawn_by_person_id_fkey` FOREIGN KEY (`withdrawn_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `announcement_versions` ADD CONSTRAINT `announcement_versions_announcement_id_fkey` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `announcement_versions` ADD CONSTRAINT `announcement_versions_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `announcements` ADD CONSTRAINT `announcements_current_version_id_fkey` FOREIGN KEY (`current_version_id`) REFERENCES `announcement_versions`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `announcement_audience_rules` ADD CONSTRAINT `announcement_audience_rules_announcement_id_fkey` FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `announcement_audience_rules` ADD CONSTRAINT `announcement_audience_rules_area_id_fkey` FOREIGN KEY (`area_id`) REFERENCES `administrative_areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `announcement_audience_rules` ADD CONSTRAINT `announcement_audience_rules_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `announcement_audience_rules` ADD CONSTRAINT `announcement_audience_rules_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `announcement_audience_rules` ADD CONSTRAINT `announcement_audience_rules_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `announcement_recipient_states` ADD CONSTRAINT `announcement_recipient_states_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `announcement_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `announcement_recipient_states` ADD CONSTRAINT `announcement_recipient_states_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `messages` ADD CONSTRAINT `messages_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `todos` ADD CONSTRAINT `todos_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
