-- CreateTable
CREATE TABLE `import_batches` (
    `id` CHAR(36) NOT NULL,
    `import_type` ENUM('ENTERPRISE', 'MEMBER', 'TALENT') NOT NULL,
    `status` ENUM('UPLOADED', 'PARSING', 'MAPPING_REQUIRED', 'PREVIEW_READY', 'APPLYING', 'SUCCEEDED', 'FAILED', 'CANCELED') NOT NULL DEFAULT 'UPLOADED',
    `source_attachment_id` CHAR(36) NOT NULL,
    `source_sha256` CHAR(64) NOT NULL,
    `original_filename` VARCHAR(255) NOT NULL,
    `sheet_name` VARCHAR(255) NULL,
    `mapping_json` JSON NULL,
    `mapping_version` INTEGER UNSIGNED NOT NULL DEFAULT 1,
    `preview_version` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `row_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `valid_row_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `blocking_row_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `warning_row_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `result_json` JSON NULL,
    `created_by_person_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,
    `parsed_at` DATETIME(3) NULL,
    `applied_at` DATETIME(3) NULL,
    `failed_at` DATETIME(3) NULL,
    `error_code` VARCHAR(100) NULL,

    UNIQUE INDEX `import_batches_source_attachment_id_key`(`source_attachment_id`),
    INDEX `import_batches_created_by_person_id_created_at_idx`(`created_by_person_id`, `created_at`),
    INDEX `import_batches_status_created_at_idx`(`status`, `created_at`),
    INDEX `import_batches_import_type_created_at_idx`(`import_type`, `created_at`),
    INDEX `import_batches_source_sha256_idx`(`source_sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_rows` (
    `id` CHAR(36) NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `row_number` INTEGER UNSIGNED NOT NULL,
    `raw_json` JSON NOT NULL,
    `normalized_json` JSON NULL,
    `row_fingerprint` CHAR(64) NULL,
    `action` ENUM('CREATE', 'UPDATE', 'LINK_EXISTING', 'SKIP', 'MANUAL_REVIEW', 'INVALID') NOT NULL,
    `resolution_status` ENUM('AUTO_RESOLVED', 'NEEDS_REVIEW', 'RESOLVED', 'BLOCKED') NOT NULL,
    `matched_entity_id` CHAR(36) NULL,
    `candidate_json` JSON NULL,
    `issues_json` JSON NULL,
    `resolution_json` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `import_rows_batch_id_row_number_key`(`batch_id`, `row_number`),
    INDEX `import_rows_batch_id_resolution_status_row_number_idx`(`batch_id`, `resolution_status`, `row_number`),
    INDEX `import_rows_batch_id_action_row_number_idx`(`batch_id`, `action`, `row_number`),
    INDEX `import_rows_row_fingerprint_idx`(`row_fingerprint`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_command_idempotency` (
    `id` CHAR(36) NOT NULL,
    `actor_person_id` CHAR(36) NOT NULL,
    `action` VARCHAR(64) NOT NULL,
    `key_hash` CHAR(64) NOT NULL,
    `payload_hash` CHAR(64) NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `preview_version` INTEGER UNSIGNED NOT NULL,
    `response_json` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `import_command_idempotency_actor_person_id_action_key_hash_key`(`actor_person_id`, `action`, `key_hash`),
    INDEX `import_command_idempotency_batch_id_created_at_idx`(`batch_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_apply_snapshots` (
    `id` CHAR(36) NOT NULL,
    `batch_id` CHAR(36) NOT NULL,
    `entity_type` VARCHAR(100) NOT NULL,
    `entity_id` CHAR(36) NULL,
    `before_json` JSON NULL,
    `created_entity_id` CHAR(36) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `import_apply_snapshots_batch_id_created_at_idx`(`batch_id`, `created_at`),
    INDEX `import_apply_snapshots_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_source_attachment_id_fkey` FOREIGN KEY (`source_attachment_id`) REFERENCES `attachments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_batches` ADD CONSTRAINT `import_batches_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_rows` ADD CONSTRAINT `import_rows_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_command_idempotency` ADD CONSTRAINT `import_command_idempotency_actor_person_id_fkey` FOREIGN KEY (`actor_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_command_idempotency` ADD CONSTRAINT `import_command_idempotency_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_apply_snapshots` ADD CONSTRAINT `import_apply_snapshots_batch_id_fkey` FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
