-- M2.2 Map foundation: append-only, versioned administrative boundaries.
CREATE TABLE `map_boundary_versions` (
  `id` CHAR(36) NOT NULL,
  `area_id` CHAR(36) NOT NULL,
  `version_no` INT UNSIGNED NOT NULL,
  `geo_json` JSON NOT NULL,
  `checksum` CHAR(64) NOT NULL,
  `source_filename` VARCHAR(255) NULL,
  `is_current` BOOLEAN NOT NULL DEFAULT false,
  `change_reason` VARCHAR(500) NOT NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `map_boundary_versions_area_id_version_no_key` (`area_id`, `version_no`),
  INDEX `map_boundary_versions_area_id_is_current_idx` (`area_id`, `is_current`),
  INDEX `map_boundary_versions_created_by_person_id_created_at_idx` (`created_by_person_id`, `created_at`),
  CONSTRAINT `map_boundary_versions_area_id_fkey` FOREIGN KEY (`area_id`) REFERENCES `administrative_areas` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `map_boundary_versions_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
