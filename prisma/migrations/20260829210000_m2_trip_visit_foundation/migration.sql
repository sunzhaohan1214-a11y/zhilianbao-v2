-- M2.4 Trip / Visit foundation: shared trips, derived status facts, results and enterprise visits.
CREATE TABLE `trips` (
  `id` CHAR(36) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `purpose` TEXT NOT NULL,
  `note` TEXT NULL,
  `sharing_restricted` BOOLEAN NOT NULL DEFAULT false,
  `overall_end_at` DATETIME(3) NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `canceled_at` DATETIME(3) NULL,
  `canceled_by_person_id` CHAR(36) NULL,
  `cancel_reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `trips_created_by_person_id_created_at_idx` (`created_by_person_id`, `created_at`),
  INDEX `trips_canceled_at_created_at_idx` (`canceled_at`, `created_at`),
  CONSTRAINT `trips_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `trips_canceled_by_person_id_fkey` FOREIGN KEY (`canceled_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `trip_participants` (
  `id` CHAR(36) NOT NULL,
  `trip_id` CHAR(36) NOT NULL,
  `person_id` CHAR(36) NOT NULL,
  `is_creator` BOOLEAN NOT NULL DEFAULT false,
  `joined_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `left_at` DATETIME(3) NULL,
  `added_by_person_id` CHAR(36) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `trip_participants_trip_id_person_id_key` (`trip_id`, `person_id`),
  INDEX `trip_participants_person_id_left_at_joined_at_idx` (`person_id`, `left_at`, `joined_at`),
  INDEX `trip_participants_added_by_person_id_joined_at_idx` (`added_by_person_id`, `joined_at`),
  CONSTRAINT `trip_participants_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `trip_participants_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `trip_participants_added_by_person_id_fkey` FOREIGN KEY (`added_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `trip_nodes` (
  `id` CHAR(36) NOT NULL,
  `trip_id` CHAR(36) NOT NULL,
  `sequence_no` INT UNSIGNED NOT NULL,
  `planned_start_at` DATETIME(3) NOT NULL,
  `planned_end_at` DATETIME(3) NULL,
  `enterprise_id` CHAR(36) NULL,
  `location_name` VARCHAR(200) NOT NULL,
  `address` VARCHAR(500) NULL,
  `content` TEXT NOT NULL,
  `node_result_summary` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `trip_nodes_trip_id_sequence_no_key` (`trip_id`, `sequence_no`),
  UNIQUE INDEX `trip_nodes_trip_id_enterprise_id_key` (`trip_id`, `enterprise_id`),
  INDEX `trip_nodes_enterprise_id_planned_start_at_idx` (`enterprise_id`, `planned_start_at`),
  INDEX `trip_nodes_planned_start_at_planned_end_at_idx` (`planned_start_at`, `planned_end_at`),
  CONSTRAINT `trip_nodes_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `trip_nodes_enterprise_id_fkey` FOREIGN KEY (`enterprise_id`) REFERENCES `enterprises` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `trip_results` (
  `id` CHAR(36) NOT NULL,
  `trip_id` CHAR(36) NOT NULL,
  `result_summary` TEXT NOT NULL,
  `next_step` TEXT NULL,
  `submitted_by_person_id` CHAR(36) NOT NULL,
  `submitted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `trip_results_trip_id_key` (`trip_id`),
  INDEX `trip_results_submitted_by_person_id_submitted_at_idx` (`submitted_by_person_id`, `submitted_at`),
  CONSTRAINT `trip_results_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `trip_results_submitted_by_person_id_fkey` FOREIGN KEY (`submitted_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `enterprise_visits` (
  `id` CHAR(36) NOT NULL,
  `trip_id` CHAR(36) NOT NULL,
  `trip_node_id` CHAR(36) NOT NULL,
  `enterprise_id` CHAR(36) NOT NULL,
  `visited_at` DATETIME(3) NOT NULL,
  `visit_summary` TEXT NULL,
  `created_from_trip_result_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `enterprise_visits_trip_node_id_key` (`trip_node_id`),
  UNIQUE INDEX `enterprise_visits_trip_id_enterprise_id_key` (`trip_id`, `enterprise_id`),
  INDEX `enterprise_visits_enterprise_id_visited_at_idx` (`enterprise_id`, `visited_at`),
  INDEX `enterprise_visits_created_from_trip_result_id_idx` (`created_from_trip_result_id`),
  CONSTRAINT `enterprise_visits_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `enterprise_visits_trip_node_id_fkey` FOREIGN KEY (`trip_node_id`) REFERENCES `trip_nodes` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `enterprise_visits_enterprise_id_fkey` FOREIGN KEY (`enterprise_id`) REFERENCES `enterprises` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `enterprise_visits_created_from_trip_result_id_fkey` FOREIGN KEY (`created_from_trip_result_id`) REFERENCES `trip_results` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `visit_supplements` (
  `id` CHAR(36) NOT NULL,
  `visit_id` CHAR(36) NOT NULL,
  `content` TEXT NOT NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `visit_supplements_visit_id_created_at_idx` (`visit_id`, `created_at`),
  INDEX `visit_supplements_created_by_person_id_created_at_idx` (`created_by_person_id`, `created_at`),
  CONSTRAINT `visit_supplements_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `enterprise_visits` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `visit_supplements_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `trip_idempotency` (
  `id` CHAR(36) NOT NULL,
  `actor_person_id` CHAR(36) NOT NULL,
  `action_code` VARCHAR(64) NOT NULL,
  `key_hash` CHAR(64) NOT NULL,
  `payload_hash` CHAR(64) NOT NULL,
  `trip_id` CHAR(36) NOT NULL,
  `trip_result_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `trip_idempotency_actor_person_id_action_code_key_hash_key` (`actor_person_id`, `action_code`, `key_hash`),
  INDEX `trip_idempotency_trip_id_created_at_idx` (`trip_id`, `created_at`),
  INDEX `trip_idempotency_trip_result_id_idx` (`trip_result_id`),
  CONSTRAINT `trip_idempotency_actor_person_id_fkey` FOREIGN KEY (`actor_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `trip_idempotency_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `trip_idempotency_trip_result_id_fkey` FOREIGN KEY (`trip_result_id`) REFERENCES `trip_results` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `visit_demand_lead_idempotency` (
  `id` CHAR(36) NOT NULL,
  `actor_person_id` CHAR(36) NOT NULL,
  `visit_id` CHAR(36) NOT NULL,
  `key_hash` CHAR(64) NOT NULL,
  `payload_hash` CHAR(64) NOT NULL,
  `demand_lead_id` CHAR(36) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `visit_demand_lead_idempotency_actor_person_id_visit_id_key_hash_key` (`actor_person_id`, `visit_id`, `key_hash`),
  INDEX `visit_demand_lead_idempotency_demand_lead_id_idx` (`demand_lead_id`),
  CONSTRAINT `visit_demand_lead_idempotency_actor_person_id_fkey` FOREIGN KEY (`actor_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `visit_demand_lead_idempotency_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `enterprise_visits` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `visit_demand_lead_idempotency_demand_lead_id_fkey` FOREIGN KEY (`demand_lead_id`) REFERENCES `demand_leads` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `demand_leads_trip_id_idx` ON `demand_leads` (`trip_id`);
CREATE INDEX `demand_leads_visit_id_idx` ON `demand_leads` (`visit_id`);
ALTER TABLE `demand_leads`
  ADD CONSTRAINT `demand_leads_trip_id_fkey` FOREIGN KEY (`trip_id`) REFERENCES `trips` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_leads_visit_id_fkey` FOREIGN KEY (`visit_id`) REFERENCES `enterprise_visits` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
