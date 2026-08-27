-- M2-006 Policy foundation. Expand-only: no existing table or column is changed.
CREATE TABLE `policies` (
  `id` CHAR(36) NOT NULL,
  `title` VARCHAR(300) NOT NULL,
  `issuing_department` VARCHAR(300) NOT NULL,
  `publication_date` DATE NOT NULL,
  `level` VARCHAR(64) NOT NULL,
  `application_deadline` DATE NULL,
  `publication_status` ENUM('DRAFT', 'PUBLISHED', 'WITHDRAWN') NOT NULL DEFAULT 'DRAFT',
  `effect_status` ENUM('CURRENT', 'REPLACED') NOT NULL DEFAULT 'CURRENT',
  `current_version_id` CHAR(36) NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `published_at` DATETIME(3) NULL,
  `withdrawn_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `policies_current_version_id_key` (`current_version_id`),
  INDEX `policies_publication_status_effect_status_publication_date_idx` (`publication_status`, `effect_status`, `publication_date`),
  INDEX `policies_title_idx` (`title`),
  INDEX `policies_issuing_department_idx` (`issuing_department`),
  PRIMARY KEY (`id`),
  CONSTRAINT `policies_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `policy_content_versions` (
  `id` CHAR(36) NOT NULL,
  `policy_id` CHAR(36) NOT NULL,
  `version_no` INTEGER UNSIGNED NOT NULL,
  `snapshot_json` JSON NOT NULL,
  `change_reason` VARCHAR(500) NULL,
  `changed_by_person_id` CHAR(36) NOT NULL,
  `core_fields_confirmed_at` DATETIME(3) NULL,
  `core_fields_confirmed_by_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `policy_content_versions_policy_id_version_no_key` (`policy_id`, `version_no`),
  INDEX `policy_content_versions_changed_by_person_id_created_at_idx` (`changed_by_person_id`, `created_at`),
  INDEX `policy_content_versions_core_fields_confirmed_by_id_idx` (`core_fields_confirmed_by_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `policy_content_versions_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `policy_content_versions_changed_by_person_id_fkey` FOREIGN KEY (`changed_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `policy_content_versions_core_fields_confirmed_by_id_fkey` FOREIGN KEY (`core_fields_confirmed_by_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `policies`
  ADD CONSTRAINT `policies_current_version_id_fkey` FOREIGN KEY (`current_version_id`) REFERENCES `policy_content_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `policy_tags` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `normalized_name` VARCHAR(100) NOT NULL,
  `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `policy_tags_normalized_name_key` (`normalized_name`),
  INDEX `policy_tags_status_name_idx` (`status`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `policy_tag_relations` (
  `policy_id` CHAR(36) NOT NULL,
  `tag_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `policy_tag_relations_tag_id_policy_id_idx` (`tag_id`, `policy_id`),
  PRIMARY KEY (`policy_id`, `tag_id`),
  CONSTRAINT `policy_tag_relations_policy_id_fkey` FOREIGN KEY (`policy_id`) REFERENCES `policies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `policy_tag_relations_tag_id_fkey` FOREIGN KEY (`tag_id`) REFERENCES `policy_tags` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `policy_ai_interpretations` (
  `id` CHAR(36) NOT NULL,
  `version_id` CHAR(36) NOT NULL,
  `status` ENUM('PENDING', 'COMPLETED', 'FAILED', 'CONFIRMED') NOT NULL DEFAULT 'PENDING',
  `extracted_json` JSON NULL,
  `provider` VARCHAR(100) NOT NULL,
  `model` VARCHAR(100) NOT NULL,
  `prompt_version` VARCHAR(100) NOT NULL,
  `evidence_json` JSON NULL,
  `failure_code` VARCHAR(100) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `confirmed_at` DATETIME(3) NULL,
  `confirmed_by_person_id` CHAR(36) NULL,
  INDEX `policy_ai_interpretations_version_id_created_at_idx` (`version_id`, `created_at`),
  INDEX `policy_ai_interpretations_status_created_at_idx` (`status`, `created_at`),
  INDEX `policy_ai_interpretations_confirmed_by_person_id_idx` (`confirmed_by_person_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `policy_ai_interpretations_version_id_fkey` FOREIGN KEY (`version_id`) REFERENCES `policy_content_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `policy_ai_interpretations_confirmed_by_person_id_fkey` FOREIGN KEY (`confirmed_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `policy_replacement_relations` (
  `id` CHAR(36) NOT NULL,
  `old_policy_id` CHAR(36) NOT NULL,
  `new_policy_id` CHAR(36) NOT NULL,
  `effective_at` DATETIME(3) NOT NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `ended_at` DATETIME(3) NULL,
  `ended_by_person_id` CHAR(36) NULL,
  `end_reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `policy_replacement_unique` (`old_policy_id`, `new_policy_id`, `effective_at`),
  INDEX `policy_replacement_relations_old_policy_id_ended_at_idx` (`old_policy_id`, `ended_at`),
  INDEX `policy_replacement_relations_new_policy_id_ended_at_idx` (`new_policy_id`, `ended_at`),
  INDEX `policy_replacement_relations_created_by_person_id_created_at_idx` (`created_by_person_id`, `created_at`),
  INDEX `policy_replacement_relations_ended_by_person_id_idx` (`ended_by_person_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `policy_replacement_relations_old_policy_id_fkey` FOREIGN KEY (`old_policy_id`) REFERENCES `policies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `policy_replacement_relations_new_policy_id_fkey` FOREIGN KEY (`new_policy_id`) REFERENCES `policies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `policy_replacement_relations_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `policy_replacement_relations_ended_by_person_id_fkey` FOREIGN KEY (`ended_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
