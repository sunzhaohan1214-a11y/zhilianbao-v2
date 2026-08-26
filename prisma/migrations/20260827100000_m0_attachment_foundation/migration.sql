-- CreateTable
CREATE TABLE `attachments` (
    `id` CHAR(36) NOT NULL,
    `original_filename` VARCHAR(255) NOT NULL,
    `extension` VARCHAR(16) NOT NULL,
    `declared_mime_type` VARCHAR(191) NOT NULL,
    `detected_mime_type` VARCHAR(191) NULL,
    `detected_file_type` VARCHAR(32) NULL,
    `expected_size_bytes` BIGINT UNSIGNED NOT NULL,
    `actual_size_bytes` BIGINT UNSIGNED NULL,
    `sha256` CHAR(64) NULL,
    `storage_provider` ENUM('TENCENT_COS') NOT NULL DEFAULT 'TENCENT_COS',
    `bucket` VARCHAR(255) NOT NULL,
    `region` VARCHAR(64) NOT NULL,
    `staging_object_key` VARCHAR(1024) NULL,
    `object_key` VARCHAR(1024) NULL,
    `upload_status` ENUM('PENDING_UPLOAD', 'UPLOADED', 'ABORTED', 'FAILED') NOT NULL DEFAULT 'PENDING_UPLOAD',
    `scan_status` ENUM('PENDING', 'SCANNING', 'PASSED', 'REJECTED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `scan_reason` VARCHAR(255) NULL,
    `is_temporary` BOOLEAN NOT NULL DEFAULT true,
    `permission_level` ENUM('PARENT_AUTHORIZED', 'SENSITIVE_PARENT') NOT NULL DEFAULT 'PARENT_AUTHORIZED',
    `uploaded_by_person_id` CHAR(36) NOT NULL,
    `upload_expires_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `attachments_uploaded_by_person_id_is_temporary_upload_sta_idx`(`uploaded_by_person_id`, `is_temporary`, `upload_status`),
    INDEX `attachments_upload_status_scan_status_idx`(`upload_status`, `scan_status`),
    INDEX `attachments_upload_expires_at_is_temporary_idx`(`upload_expires_at`, `is_temporary`),
    INDEX `attachments_sha256_idx`(`sha256`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attachment_links` (
    `id` CHAR(36) NOT NULL,
    `attachment_id` CHAR(36) NOT NULL,
    `entity_type` VARCHAR(100) NOT NULL,
    `entity_id` CHAR(36) NOT NULL,
    `relation_type` VARCHAR(100) NOT NULL,
    `created_by_person_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `attachment_links_attachment_id_entity_type_entity_id_relati_key`(`attachment_id`, `entity_type`, `entity_id`, `relation_type`),
    INDEX `attachment_links_entity_type_entity_id_idx`(`entity_type`, `entity_id`),
    INDEX `attachment_links_created_by_person_id_created_at_idx`(`created_by_person_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attachment_access_logs` (
    `id` CHAR(36) NOT NULL,
    `attachment_id` CHAR(36) NOT NULL,
    `person_id` CHAR(36) NOT NULL,
    `action` ENUM('PREVIEW', 'DOWNLOAD') NOT NULL,
    `ip` VARCHAR(45) NOT NULL,
    `device` VARCHAR(255) NULL,
    `request_id` VARCHAR(100) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `attachment_access_logs_attachment_id_created_at_idx`(`attachment_id`, `created_at`),
    INDEX `attachment_access_logs_person_id_created_at_idx`(`person_id`, `created_at`),
    INDEX `attachment_access_logs_request_id_idx`(`request_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_uploaded_by_person_id_fkey` FOREIGN KEY (`uploaded_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attachment_links` ADD CONSTRAINT `attachment_links_attachment_id_fkey` FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attachment_links` ADD CONSTRAINT `attachment_links_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attachment_access_logs` ADD CONSTRAINT `attachment_access_logs_attachment_id_fkey` FOREIGN KEY (`attachment_id`) REFERENCES `attachments`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attachment_access_logs` ADD CONSTRAINT `attachment_access_logs_person_id_fkey` FOREIGN KEY (`person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
