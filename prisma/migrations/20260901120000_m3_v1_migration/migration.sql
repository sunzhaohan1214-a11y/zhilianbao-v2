-- AlterTable: V1 “已通过” is a dedicated read-only terminal and never enters paper/finance flow.
ALTER TABLE `reimbursements` MODIFY `status` ENUM('DRAFT', 'PENDING_ONLINE_REVIEW', 'RETURNED', 'VERIFIED_PENDING_PAPER', 'PAPER_RECEIVED', 'FINANCE_SUBMITTED', 'LEGACY_VERIFIED_TERMINAL') NOT NULL DEFAULT 'DRAFT';

-- CreateTable
CREATE TABLE `migration_batches` (
    `id` CHAR(36) NOT NULL,
    `source_system` VARCHAR(50) NOT NULL,
    `snapshot_id` VARCHAR(191) NOT NULL,
    `snapshot_at` DATETIME(3) NOT NULL,
    `source_schema_version` VARCHAR(100) NOT NULL,
    `source_manifest_sha256` CHAR(64) NOT NULL,
    `code_version` VARCHAR(100) NOT NULL,
    `mapping_version` VARCHAR(100) NOT NULL,
    `resolution_version` VARCHAR(100) NULL,
    `status` ENUM('CREATED', 'VALIDATING', 'READY', 'RUNNING', 'REVIEW_REQUIRED', 'RECONCILING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'SIGNED_OFF') NOT NULL DEFAULT 'CREATED',
    `mode` ENUM('SAMPLE_REHEARSAL', 'FULL_REHEARSAL', 'FINAL_INCREMENTAL') NOT NULL,
    `active_key` VARCHAR(50) NULL,
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `created_by_person_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reconciliation_json` JSON NULL,
    `failure_code` VARCHAR(100) NULL,
    `failure_summary` VARCHAR(1000) NULL,
    `signed_off_by_person_id` CHAR(36) NULL,
    `signed_off_at` DATETIME(3) NULL,

    UNIQUE INDEX `migration_batches_active_key_key`(`active_key`),
    INDEX `migration_batches_source_system_status_created_at_idx`(`source_system`, `status`, `created_at`),
    INDEX `migration_batches_created_by_person_id_created_at_idx`(`created_by_person_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `legacy_migration_maps` (
    `id` CHAR(36) NOT NULL,
    `source_system` VARCHAR(50) NOT NULL,
    `source_entity` VARCHAR(100) NOT NULL,
    `source_id` VARCHAR(191) NOT NULL,
    `target_entity` VARCHAR(100) NOT NULL,
    `target_id` CHAR(36) NOT NULL,
    `source_fingerprint` CHAR(64) NOT NULL,
    `immutable_history` BOOLEAN NOT NULL DEFAULT false,
    `first_migration_batch_id` CHAR(36) NOT NULL,
    `last_migration_batch_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `legacy_migration_source_key`(`source_system`, `source_entity`, `source_id`),
    INDEX `legacy_migration_maps_target_entity_target_id_idx`(`target_entity`, `target_id`),
    INDEX `legacy_migration_maps_first_migration_batch_id_idx`(`first_migration_batch_id`),
    INDEX `legacy_migration_maps_last_migration_batch_id_idx`(`last_migration_batch_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `migration_issues` (
    `id` CHAR(36) NOT NULL,
    `migration_batch_id` CHAR(36) NOT NULL,
    `source_entity` VARCHAR(100) NOT NULL,
    `source_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `severity` ENUM('WARNING', 'REVIEW', 'BLOCKER') NOT NULL,
    `field` VARCHAR(100) NULL,
    `message` VARCHAR(1000) NOT NULL,
    `candidate_json` JSON NULL,
    `source_snapshot_json` JSON NULL,
    `status` ENUM('OPEN', 'RESOLVED', 'WAIVED') NOT NULL DEFAULT 'OPEN',
    `resolution_json` JSON NULL,
    `resolved_by_person_id` CHAR(36) NULL,
    `resolved_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `migration_issue_source_code_key`(`migration_batch_id`, `source_entity`, `source_id`, `code`, `field`),
    INDEX `migration_issues_migration_batch_id_status_severity_idx`(`migration_batch_id`, `status`, `severity`),
    INDEX `migration_issues_resolved_by_person_id_resolved_at_idx`(`resolved_by_person_id`, `resolved_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `migration_module_results` (
    `batch_id` CHAR(36) NOT NULL,
    `module` VARCHAR(100) NOT NULL,
    `source_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `success_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `failed_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `skipped_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `merged_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `review_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `attachment_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `attachment_success_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `attachment_issue_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `started_at` DATETIME(3) NOT NULL,
    `finished_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`batch_id`, `module`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `migration_attachment_results` (
    `id` CHAR(36) NOT NULL,
    `migration_batch_id` CHAR(36) NOT NULL,
    `source_entity` VARCHAR(100) NOT NULL,
    `source_id` VARCHAR(191) NOT NULL,
    `source_attachment_key` VARCHAR(191) NOT NULL,
    `status` ENUM('PENDING', 'COPIED', 'MISSING', 'CORRUPTED', 'COPY_FAILED', 'HASH_MISMATCH', 'SKIPPED') NOT NULL DEFAULT 'PENDING',
    `source_sha256` CHAR(64) NULL,
    `target_attachment_id` CHAR(36) NULL,
    `target_sha256` CHAR(64) NULL,
    `source_size` BIGINT UNSIGNED NULL,
    `target_size` BIGINT UNSIGNED NULL,
    `error_code` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `migration_attachment_source_key`(`migration_batch_id`, `source_entity`, `source_id`, `source_attachment_key`),
    INDEX `migration_attachment_results_migration_batch_id_status_idx`(`migration_batch_id`, `status`),
    INDEX `migration_attachment_results_target_attachment_id_idx`(`target_attachment_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `migration_batches` ADD CONSTRAINT `migration_batches_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `migration_batches` ADD CONSTRAINT `migration_batches_signed_off_by_person_id_fkey` FOREIGN KEY (`signed_off_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `legacy_migration_maps` ADD CONSTRAINT `legacy_migration_maps_first_migration_batch_id_fkey` FOREIGN KEY (`first_migration_batch_id`) REFERENCES `migration_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `legacy_migration_maps` ADD CONSTRAINT `legacy_migration_maps_last_migration_batch_id_fkey` FOREIGN KEY (`last_migration_batch_id`) REFERENCES `migration_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `migration_issues` ADD CONSTRAINT `migration_issues_migration_batch_id_fkey` FOREIGN KEY (`migration_batch_id`) REFERENCES `migration_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `migration_issues` ADD CONSTRAINT `migration_issues_resolved_by_person_id_fkey` FOREIGN KEY (`resolved_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `migration_module_results` ADD CONSTRAINT `migration_module_results_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `migration_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `migration_attachment_results` ADD CONSTRAINT `migration_attachment_results_migration_batch_id_fkey` FOREIGN KEY (`migration_batch_id`) REFERENCES `migration_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `migration_attachment_results` ADD CONSTRAINT `migration_attachment_results_target_attachment_id_fkey` FOREIGN KEY (`target_attachment_id`) REFERENCES `attachments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
