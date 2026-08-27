-- M2-001 stores historical contact phones on the permanent Person record so
-- accountless alumni remain reachable without creating fake login accounts.
ALTER TABLE `persons`
  ADD COLUMN `contact_phone` VARCHAR(30) NULL;

-- Capability data is normalized for stable filtering and future recommendation.
CREATE TABLE `member_capability_profiles` (
  `id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `professional_direction` VARCHAR(500) NULL,
  `coordinatable_resources` TEXT NULL,
  `personal_introduction` TEXT NULL,
  `updated_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `member_capability_profiles_person_id_key`(`person_id`),
  INDEX `member_capability_profiles_updated_by_person_id_updated_at_idx`(`updated_by_person_id`, `updated_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `member_industries` (
  `id` CHAR(36) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `member_industries_name_key`(`name`),
  INDEX `member_industries_status_name_idx`(`status`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `member_capability_industries` (
  `person_id` CHAR(36) NOT NULL,
  `industry_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `member_capability_industries_industry_id_person_id_idx`(`industry_id`, `person_id`),
  PRIMARY KEY (`person_id`, `industry_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `member_preferred_demand_types` (
  `person_id` CHAR(36) NOT NULL,
  `demand_type` ENUM('TECHNICAL', 'TALENT', 'PROJECT', 'OTHER') NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  INDEX `member_preferred_demand_types_demand_type_person_id_idx`(`demand_type`, `person_id`),
  PRIMARY KEY (`person_id`, `demand_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `member_capability_profiles`
  ADD CONSTRAINT `member_capability_profiles_person_id_fkey`
  FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `member_capability_profiles_updated_by_person_id_fkey`
  FOREIGN KEY (`updated_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `member_capability_industries`
  ADD CONSTRAINT `member_capability_industries_person_id_fkey`
  FOREIGN KEY (`person_id`) REFERENCES `member_capability_profiles`(`person_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `member_capability_industries_industry_id_fkey`
  FOREIGN KEY (`industry_id`) REFERENCES `member_industries`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `member_preferred_demand_types`
  ADD CONSTRAINT `member_preferred_demand_types_person_id_fkey`
  FOREIGN KEY (`person_id`) REFERENCES `member_capability_profiles`(`person_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
