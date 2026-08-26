-- CreateTable
CREATE TABLE `persons` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `person_status` ENUM('ACTIVE', 'ARCHIVED') NOT NULL DEFAULT 'ACTIVE',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `persons_person_status_idx`(`person_status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `accounts` (
    `id` CHAR(36) NOT NULL,
    `person_id` CHAR(36) NOT NULL,
    `phone` VARCHAR(20) NOT NULL,
    `password_hash` VARCHAR(255) NOT NULL,
    `status` ENUM('PENDING_ENABLE', 'UNACTIVATED', 'NORMAL', 'DISABLED') NOT NULL DEFAULT 'PENDING_ENABLE',
    `force_password_change` BOOLEAN NOT NULL DEFAULT false,
    `first_password_changed_at` DATETIME(3) NULL,
    `confidentiality_confirmed_at` DATETIME(3) NULL,
    `permission_version` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `last_login_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `accounts_person_id_key`(`person_id`),
    UNIQUE INDEX `accounts_phone_key`(`phone`),
    INDEX `accounts_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_phone_history` (
    `id` CHAR(36) NOT NULL,
    `account_id` CHAR(36) NOT NULL,
    `old_phone` VARCHAR(20) NOT NULL,
    `new_phone` VARCHAR(20) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `changed_by_person_id` CHAR(36) NOT NULL,
    `changed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `account_phone_history_account_id_changed_at_idx`(`account_id`, `changed_at`),
    INDEX `account_phone_history_changed_by_person_id_changed_at_idx`(`changed_by_person_id`, `changed_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `sessions` (
    `id` CHAR(36) NOT NULL,
    `account_id` CHAR(36) NOT NULL,
    `token_hash` CHAR(64) NOT NULL,
    `device_id` VARCHAR(255) NOT NULL,
    `device_name` VARCHAR(100) NULL,
    `user_agent` VARCHAR(500) NULL,
    `ip_last` VARCHAR(45) NULL,
    `permission_version` BIGINT UNSIGNED NOT NULL,
    `expires_at` DATETIME(3) NOT NULL,
    `revoked_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `sessions_token_hash_key`(`token_hash`),
    INDEX `sessions_account_id_revoked_at_expires_at_idx`(`account_id`, `revoked_at`, `expires_at`),
    INDEX `sessions_expires_at_idx`(`expires_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organizations` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `type` ENUM('TOWNSHIP_ORG', 'DEPARTMENT', 'DISPATCH_UNIT', 'POST_UNIT', 'OTHER_INTERNAL') NOT NULL,
    `parent_id` CHAR(36) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `phone` VARCHAR(30) NULL,
    `address` VARCHAR(500) NULL,
    `latitude` DECIMAL(10, 7) NULL,
    `longitude` DECIMAL(11, 7) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `organizations_parent_id_idx`(`parent_id`),
    INDEX `organizations_type_status_idx`(`type`, `status`),
    INDEX `organizations_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `administrative_areas` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(200) NOT NULL,
    `type` ENUM('COUNTY', 'TOWNSHIP', 'PARK', 'HIGH_TECH_ZONE', 'DEVELOPMENT_ZONE', 'OTHER_AREA') NOT NULL,
    `parent_id` CHAR(36) NULL,
    `status` ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
    `sort_order` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `administrative_areas_parent_id_idx`(`parent_id`),
    INDEX `administrative_areas_type_status_sort_order_idx`(`type`, `status`, `sort_order`),
    INDEX `administrative_areas_name_idx`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `organization_area_mappings` (
    `id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `area_id` CHAR(36) NOT NULL,
    `effective_at` DATETIME(3) NOT NULL,
    `expired_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `organization_area_mappings_organization_id_effective_at_expi_idx`(`organization_id`, `effective_at`, `expired_at`),
    INDEX `organization_area_mappings_area_id_effective_at_expired_at_idx`(`area_id`, `effective_at`, `expired_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `appointments` (
    `id` CHAR(36) NOT NULL,
    `person_id` CHAR(36) NOT NULL,
    `organization_id` CHAR(36) NOT NULL,
    `position_title` VARCHAR(100) NOT NULL,
    `effective_at` DATETIME(3) NOT NULL,
    `expired_at` DATETIME(3) NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `appointments_person_id_effective_at_expired_at_idx`(`person_id`, `effective_at`, `expired_at`),
    INDEX `appointments_organization_id_effective_at_expired_at_idx`(`organization_id`, `effective_at`, `expired_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `department_township_relations` (
    `id` CHAR(36) NOT NULL,
    `department_organization_id` CHAR(36) NOT NULL,
    `area_id` CHAR(36) NOT NULL,
    `effective_at` DATETIME(3) NOT NULL,
    `expired_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `department_township_relations_department_organization_id_eff_idx`(`department_organization_id`, `effective_at`, `expired_at`),
    INDEX `department_township_relations_area_id_effective_at_expired_a_idx`(`area_id`, `effective_at`, `expired_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_assignments` (
    `id` CHAR(36) NOT NULL,
    `person_id` CHAR(36) NOT NULL,
    `role_code` ENUM('MEMBER_CURRENT', 'MEMBER_ALUMNI_PLATFORM', 'GROUP_LEADER', 'MINISTER', 'TOWNSHIP_STAFF', 'DEPARTMENT_STAFF', 'ADMIN', 'SUPER_ADMIN', 'LEADER_STAGE2') NOT NULL,
    `effective_at` DATETIME(3) NOT NULL,
    `expired_at` DATETIME(3) NULL,
    `granted_by_person_id` CHAR(36) NULL,
    `reason` VARCHAR(500) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `role_assignments_person_id_effective_at_expired_at_idx`(`person_id`, `effective_at`, `expired_at`),
    INDEX `role_assignments_role_code_effective_at_expired_at_idx`(`role_code`, `effective_at`, `expired_at`),
    INDEX `role_assignments_granted_by_person_id_idx`(`granted_by_person_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `special_permission_grants` (
    `id` CHAR(36) NOT NULL,
    `person_id` CHAR(36) NOT NULL,
    `permission_code` VARCHAR(100) NOT NULL,
    `effective_at` DATETIME(3) NOT NULL,
    `expired_at` DATETIME(3) NULL,
    `reason` VARCHAR(500) NOT NULL,
    `granted_by_person_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `special_permission_grants_person_id_effective_at_expired_at_idx`(`person_id`, `effective_at`, `expired_at`),
    INDEX `special_permission_grants_permission_code_effective_at_expir_idx`(`permission_code`, `effective_at`, `expired_at`),
    INDEX `special_permission_grants_granted_by_person_id_idx`(`granted_by_person_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `batches` (
    `id` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `year` SMALLINT UNSIGNED NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NULL,
    `status` ENUM('PLANNED', 'ACTIVE', 'CLOSED') NOT NULL DEFAULT 'PLANNED',
    `is_current` BOOLEAN NOT NULL DEFAULT false,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `batches_status_is_current_idx`(`status`, `is_current`),
    INDEX `batches_year_idx`(`year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `batch_memberships` (
    `id` CHAR(36) NOT NULL,
    `person_id` CHAR(36) NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `dispatch_organization_id` CHAR(36) NULL,
    `post_organization_id` CHAR(36) NULL,
    `position_title` VARCHAR(100) NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NULL,
    `status` VARCHAR(32) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `batch_memberships_batch_id_status_idx`(`batch_id`, `status`),
    INDEX `batch_memberships_dispatch_organization_id_idx`(`dispatch_organization_id`),
    INDEX `batch_memberships_post_organization_id_idx`(`post_organization_id`),
    UNIQUE INDEX `batch_memberships_person_id_batch_id_key`(`person_id`, `batch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `group_leader_assignments` (
    `id` CHAR(36) NOT NULL,
    `person_id` CHAR(36) NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `effective_at` DATETIME(3) NOT NULL,
    `expired_at` DATETIME(3) NULL,
    `granted_by_person_id` CHAR(36) NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `group_leader_assignments_person_id_effective_at_expired_at_idx`(`person_id`, `effective_at`, `expired_at`),
    INDEX `group_leader_assignments_batch_id_effective_at_expired_at_idx`(`batch_id`, `effective_at`, `expired_at`),
    INDEX `group_leader_assignments_granted_by_person_id_idx`(`granted_by_person_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `business_sequences` (
    `id` CHAR(36) NOT NULL,
    `prefix` VARCHAR(10) NOT NULL,
    `year` SMALLINT UNSIGNED NOT NULL,
    `current_value` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `business_sequences_prefix_year_key`(`prefix`, `year`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` CHAR(36) NOT NULL,
    `actor_person_id` CHAR(36) NULL,
    `actor_account_id` CHAR(36) NULL,
    `action_code` VARCHAR(100) NOT NULL,
    `entity_type` VARCHAR(100) NOT NULL,
    `entity_id` CHAR(36) NULL,
    `before_json` JSON NULL,
    `after_json` JSON NULL,
    `reason` VARCHAR(500) NULL,
    `ip` VARCHAR(45) NULL,
    `device` VARCHAR(255) NULL,
    `request_id` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_actor_person_id_created_at_idx`(`actor_person_id`, `created_at`),
    INDEX `audit_logs_actor_account_id_created_at_idx`(`actor_account_id`, `created_at`),
    INDEX `audit_logs_entity_type_entity_id_created_at_idx`(`entity_type`, `entity_id`, `created_at`),
    INDEX `audit_logs_request_id_idx`(`request_id`),
    INDEX `audit_logs_created_at_idx`(`created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `state_transition_history` (
    `id` CHAR(36) NOT NULL,
    `entity_type` VARCHAR(100) NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `from_state` VARCHAR(100) NULL,
    `to_state` VARCHAR(100) NOT NULL,
    `action_code` VARCHAR(100) NOT NULL,
    `actor_person_id` CHAR(36) NULL,
    `reason` VARCHAR(500) NULL,
    `metadata_json` JSON NULL,
    `request_id` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `state_transition_history_entity_type_entity_id_created_at_idx`(`entity_type`, `entity_id`, `created_at`),
    INDEX `state_transition_history_actor_person_id_created_at_idx`(`actor_person_id`, `created_at`),
    INDEX `state_transition_history_request_id_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outbox_events` (
    `id` CHAR(36) NOT NULL,
    `event_type` VARCHAR(100) NOT NULL,
    `aggregate_type` VARCHAR(100) NOT NULL,
    `aggregate_id` CHAR(36) NOT NULL,
    `payload_json` JSON NOT NULL,
    `dedupe_key` VARCHAR(191) NULL,
    `occurred_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `published_at` DATETIME(3) NULL,
    `attempts` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `last_error` TEXT NULL,

    UNIQUE INDEX `outbox_events_dedupe_key_key`(`dedupe_key`),
    INDEX `outbox_events_published_at_occurred_at_idx`(`published_at`, `occurred_at`),
    INDEX `outbox_events_aggregate_type_aggregate_id_occurred_at_idx`(`aggregate_type`, `aggregate_id`, `occurred_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `job_tasks` (
    `id` CHAR(36) NOT NULL,
    `job_type` VARCHAR(100) NOT NULL,
    `payload_json` JSON NOT NULL,
    `status` ENUM('WAITING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED') NOT NULL DEFAULT 'WAITING',
    `priority` INTEGER NOT NULL DEFAULT 0,
    `idempotency_key` VARCHAR(191) NOT NULL,
    `scheduled_at` DATETIME(3) NOT NULL,
    `locked_at` DATETIME(3) NULL,
    `locked_by` VARCHAR(100) NULL,
    `retry_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `max_retries` INTEGER UNSIGNED NOT NULL DEFAULT 3,
    `finished_at` DATETIME(3) NULL,
    `last_error` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `job_tasks_idempotency_key_key`(`idempotency_key`),
    INDEX `job_tasks_status_scheduled_at_priority_idx`(`status`, `scheduled_at`, `priority`),
    INDEX `job_tasks_locked_at_idx`(`locked_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_phone_history` ADD CONSTRAINT `account_phone_history_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_phone_history` ADD CONSTRAINT `account_phone_history_changed_by_person_id_fkey` FOREIGN KEY (`changed_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_account_id_fkey` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organizations` ADD CONSTRAINT `organizations_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `administrative_areas` ADD CONSTRAINT `administrative_areas_parent_id_fkey` FOREIGN KEY (`parent_id`) REFERENCES `administrative_areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_area_mappings` ADD CONSTRAINT `organization_area_mappings_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `organization_area_mappings` ADD CONSTRAINT `organization_area_mappings_area_id_fkey` FOREIGN KEY (`area_id`) REFERENCES `administrative_areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `appointments` ADD CONSTRAINT `appointments_organization_id_fkey` FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_township_relations` ADD CONSTRAINT `department_township_relations_department_organization_id_fkey` FOREIGN KEY (`department_organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `department_township_relations` ADD CONSTRAINT `department_township_relations_area_id_fkey` FOREIGN KEY (`area_id`) REFERENCES `administrative_areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_assignments` ADD CONSTRAINT `role_assignments_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_assignments` ADD CONSTRAINT `role_assignments_granted_by_person_id_fkey` FOREIGN KEY (`granted_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `special_permission_grants` ADD CONSTRAINT `special_permission_grants_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `special_permission_grants` ADD CONSTRAINT `special_permission_grants_granted_by_person_id_fkey` FOREIGN KEY (`granted_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `batch_memberships` ADD CONSTRAINT `batch_memberships_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `batch_memberships` ADD CONSTRAINT `batch_memberships_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `batch_memberships` ADD CONSTRAINT `batch_memberships_dispatch_organization_id_fkey` FOREIGN KEY (`dispatch_organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `batch_memberships` ADD CONSTRAINT `batch_memberships_post_organization_id_fkey` FOREIGN KEY (`post_organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_leader_assignments` ADD CONSTRAINT `group_leader_assignments_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_leader_assignments` ADD CONSTRAINT `group_leader_assignments_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `group_leader_assignments` ADD CONSTRAINT `group_leader_assignments_granted_by_person_id_fkey` FOREIGN KEY (`granted_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_person_id_fkey` FOREIGN KEY (`actor_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_account_id_fkey` FOREIGN KEY (`actor_account_id`) REFERENCES `accounts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `state_transition_history` ADD CONSTRAINT `state_transition_history_actor_person_id_fkey` FOREIGN KEY (`actor_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
