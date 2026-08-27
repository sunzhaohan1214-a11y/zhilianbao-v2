-- M1-001 Enterprise is an expand-only business foundation. Existing M0 tables
-- and columns remain untouched so the previous web and worker binaries stay
-- compatible during rollout.

CREATE TABLE `enterprises` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `responsible_area_id` CHAR(36) NOT NULL,
  `address` VARCHAR(500) NOT NULL,
  `credit_code` VARCHAR(32) NULL,
  `legal_representative` VARCHAR(80) NULL,
  `introduction` TEXT NULL,
  `main_products` TEXT NOT NULL,
  `qualifications_honors` TEXT NULL,
  `latitude` DECIMAL(10, 7) NULL,
  `longitude` DECIMAL(11, 7) NULL,
  `geocode_status` ENUM('UNRESOLVED', 'RESOLVED', 'MANUAL', 'FAILED') NOT NULL DEFAULT 'UNRESOLVED',
  `geocode_provider` VARCHAR(64) NULL,
  `geocoded_at` DATETIME(3) NULL,
  `coordinate_updated_by_id` CHAR(36) NULL,
  `status` ENUM('NORMAL', 'DISABLED', 'MERGED') NOT NULL DEFAULT 'NORMAL',
  `merged_into_id` CHAR(36) NULL,
  `primary_contact_id` CHAR(36) NULL,
  `current_version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
  `created_by_person_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `enterprises_credit_code_key`(`credit_code`),
  UNIQUE INDEX `enterprises_primary_contact_id_key`(`primary_contact_id`),
  INDEX `enterprises_status_responsible_area_id_idx`(`status`, `responsible_area_id`),
  INDEX `enterprises_name_idx`(`name`),
  INDEX `enterprises_merged_into_id_idx`(`merged_into_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `enterprises_merge_state_check` CHECK (
    (`status` = 'MERGED' AND `merged_into_id` IS NOT NULL)
    OR (`status` <> 'MERGED' AND `merged_into_id` IS NULL)
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `enterprise_tags` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `normalized_name` VARCHAR(100) NOT NULL,
  `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `enterprise_tags_normalized_name_key`(`normalized_name`),
  INDEX `enterprise_tags_status_name_idx`(`status`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `enterprise_contacts` (
  `id` CHAR(36) NOT NULL,
  `enterprise_id` CHAR(36) NOT NULL,
  `name` VARCHAR(80) NOT NULL,
  `position_title` VARCHAR(100) NULL,
  `phone` VARCHAR(30) NOT NULL,
  `is_primary` BOOLEAN NOT NULL DEFAULT false,
  `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_by_person_id` CHAR(36) NOT NULL,
  `inactive_reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `enterprise_contacts_enterprise_id_status_idx`(`enterprise_id`, `status`),
  INDEX `enterprise_contacts_phone_idx`(`phone`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `enterprise_tag_relations` (
  `enterprise_id` CHAR(36) NOT NULL,
  `tag_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `enterprise_tag_relations_tag_id_enterprise_id_idx`(`tag_id`, `enterprise_id`),
  PRIMARY KEY (`enterprise_id`, `tag_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `enterprise_change_requests` (
  `id` CHAR(36) NOT NULL,
  `request_type` ENUM('CREATE', 'CORRECTION') NOT NULL,
  `proposed_area_id` CHAR(36) NULL,
  `target_enterprise_id` CHAR(36) NULL,
  `payload_snapshot` JSON NOT NULL,
  `base_enterprise_version` INTEGER UNSIGNED NULL,
  `submitter_person_id` CHAR(36) NOT NULL,
  `status` ENUM('PENDING_REVIEW', 'APPROVED', 'RETURNED', 'CLOSED') NOT NULL DEFAULT 'PENDING_REVIEW',
  `reviewer_person_id` CHAR(36) NULL,
  `review_reason` VARCHAR(500) NULL,
  `approved_enterprise_id` CHAR(36) NULL,
  `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reviewed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `enterprise_change_requests_status_created_at_idx`(`status`, `created_at`),
  INDEX `enterprise_change_requests_submitter_person_id_status_idx`(`submitter_person_id`, `status`),
  INDEX `enterprise_change_requests_target_enterprise_id_idx`(`target_enterprise_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `enterprise_change_requests_shape_check` CHECK (
    (`request_type` = 'CREATE' AND `proposed_area_id` IS NOT NULL AND `target_enterprise_id` IS NULL AND `base_enterprise_version` IS NULL)
    OR (`request_type` = 'CORRECTION' AND `target_enterprise_id` IS NOT NULL AND `base_enterprise_version` IS NOT NULL)
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `enterprise_versions` (
  `id` CHAR(36) NOT NULL,
  `enterprise_id` CHAR(36) NOT NULL,
  `version_no` INTEGER UNSIGNED NOT NULL,
  `snapshot_json` JSON NOT NULL,
  `change_type` ENUM('CREATE', 'FORMAL_CORRECTION', 'CHANGE_REQUEST_APPROVED', 'DISABLE', 'RESTORE', 'MERGE', 'COORDINATE') NOT NULL,
  `reason` VARCHAR(500) NULL,
  `changed_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `enterprise_versions_enterprise_id_version_no_key`(`enterprise_id`, `version_no`),
  INDEX `enterprise_versions_changed_by_person_id_created_at_idx`(`changed_by_person_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `enterprises` ADD CONSTRAINT `enterprises_responsible_area_id_fkey` FOREIGN KEY (`responsible_area_id`) REFERENCES `administrative_areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enterprises` ADD CONSTRAINT `enterprises_merged_into_id_fkey` FOREIGN KEY (`merged_into_id`) REFERENCES `enterprises`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enterprises` ADD CONSTRAINT `enterprises_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enterprises` ADD CONSTRAINT `enterprises_coordinate_updated_by_id_fkey` FOREIGN KEY (`coordinate_updated_by_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `enterprise_contacts` ADD CONSTRAINT `enterprise_contacts_enterprise_id_fkey` FOREIGN KEY (`enterprise_id`) REFERENCES `enterprises`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enterprise_contacts` ADD CONSTRAINT `enterprise_contacts_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enterprises` ADD CONSTRAINT `enterprises_primary_contact_id_fkey` FOREIGN KEY (`primary_contact_id`) REFERENCES `enterprise_contacts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `enterprise_tag_relations` ADD CONSTRAINT `enterprise_tag_relations_enterprise_id_fkey` FOREIGN KEY (`enterprise_id`) REFERENCES `enterprises`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enterprise_tag_relations` ADD CONSTRAINT `enterprise_tag_relations_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `enterprise_tags`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `enterprise_change_requests` ADD CONSTRAINT `enterprise_change_requests_proposed_area_id_fkey` FOREIGN KEY (`proposed_area_id`) REFERENCES `administrative_areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enterprise_change_requests` ADD CONSTRAINT `enterprise_change_requests_target_enterprise_id_fkey` FOREIGN KEY (`target_enterprise_id`) REFERENCES `enterprises`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enterprise_change_requests` ADD CONSTRAINT `enterprise_change_requests_approved_enterprise_id_fkey` FOREIGN KEY (`approved_enterprise_id`) REFERENCES `enterprises`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enterprise_change_requests` ADD CONSTRAINT `enterprise_change_requests_submitter_person_id_fkey` FOREIGN KEY (`submitter_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enterprise_change_requests` ADD CONSTRAINT `enterprise_change_requests_reviewer_person_id_fkey` FOREIGN KEY (`reviewer_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `enterprise_versions` ADD CONSTRAINT `enterprise_versions_enterprise_id_fkey` FOREIGN KEY (`enterprise_id`) REFERENCES `enterprises`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enterprise_versions` ADD CONSTRAINT `enterprise_versions_changed_by_person_id_fkey` FOREIGN KEY (`changed_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
