-- AlterTable
ALTER TABLE `attachments`
    MODIFY `uploaded_by_person_id` CHAR(36) NULL,
    ADD COLUMN `public_upload_token_hash` CHAR(64) NULL,
    ADD COLUMN `public_area_id` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `attachment_links`
    MODIFY `created_by_person_id` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `demands` (
    `id` CHAR(36) NOT NULL,
    `business_no` VARCHAR(32) NOT NULL,
    `enterprise_id` CHAR(36) NOT NULL,
    `responsible_area_id` CHAR(36) NOT NULL,
    `selected_contact_id` CHAR(36) NOT NULL,
    `title` VARCHAR(200) NOT NULL,
    `original_description` TEXT NOT NULL,
    `demand_type` ENUM('TECHNICAL', 'TALENT', 'PROJECT', 'OTHER') NOT NULL,
    `urgency` ENUM('NORMAL', 'URGENT') NOT NULL DEFAULT 'NORMAL',
    `status` ENUM('DRAFT', 'PENDING_REVIEW', 'RETURNED', 'PENDING_CLAIM', 'IN_PROGRESS', 'PENDING_CLOSE_REVIEW', 'COMPLETED', 'CANCELED', 'MERGED') NOT NULL DEFAULT 'DRAFT',
    `creation_batch_id` CHAR(36) NOT NULL,
    `current_follow_batch_id` CHAR(36) NOT NULL,
    `is_cross_batch` BOOLEAN NOT NULL DEFAULT false,
    `first_published_at` DATETIME(3) NULL,
    `internal_note` VARCHAR(2000) NULL,
    `created_by_person_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `demands_business_no_key`(`business_no`),
    INDEX `demands_responsible_area_id_status_created_at_idx`(`responsible_area_id`, `status`, `created_at`),
    INDEX `demands_enterprise_id_status_idx`(`enterprise_id`, `status`),
    INDEX `demands_creation_batch_id_status_idx`(`creation_batch_id`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demand_leads` (
    `id` CHAR(36) NOT NULL,
    `business_no` VARCHAR(32) NOT NULL,
    `source_type` ENUM('ENTERPRISE_PUBLIC', 'MEMBER_VISIT', 'OTHER') NOT NULL,
    `responsible_area_id` CHAR(36) NOT NULL,
    `enterprise_id` CHAR(36) NULL,
    `raw_enterprise_name` VARCHAR(200) NULL,
    `raw_contact_name` VARCHAR(80) NULL,
    `raw_contact_phone` VARCHAR(30) NULL,
    `raw_title` VARCHAR(200) NOT NULL,
    `raw_content` TEXT NOT NULL,
    `source_person_id` CHAR(36) NULL,
    `source_channel` VARCHAR(100) NULL,
    `source_at` DATETIME(3) NOT NULL,
    `trip_id` CHAR(36) NULL,
    `visit_id` CHAR(36) NULL,
    `status` ENUM('PENDING_TOWNSHIP_VERIFY', 'PENDING_ENTERPRISE_LINK', 'NEED_MORE_INFO', 'MERGED', 'CLOSED', 'CONVERTED') NOT NULL,
    `converted_demand_id` CHAR(36) NULL,
    `merged_into_lead_id` CHAR(36) NULL,
    `close_reason` VARCHAR(500) NULL,
    `closed_from_status` ENUM('PENDING_TOWNSHIP_VERIFY', 'PENDING_ENTERPRISE_LINK', 'NEED_MORE_INFO', 'MERGED', 'CLOSED', 'CONVERTED') NULL,
    `created_by_person_id` CHAR(36) NULL,
    `public_duplicate_window_key` CHAR(64) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `demand_leads_business_no_key`(`business_no`),
    UNIQUE INDEX `demand_leads_public_duplicate_window_key_key`(`public_duplicate_window_key`),
    INDEX `demand_leads_responsible_area_id_status_created_at_idx`(`responsible_area_id`, `status`, `created_at`),
    INDEX `demand_leads_enterprise_id_status_idx`(`enterprise_id`, `status`),
    INDEX `demand_leads_source_person_id_source_at_idx`(`source_person_id`, `source_at`),
    INDEX `demand_leads_merged_into_lead_id_idx`(`merged_into_lead_id`),
    INDEX `demand_leads_converted_demand_id_idx`(`converted_demand_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demand_lead_supplements` (
    `id` CHAR(36) NOT NULL,
    `demand_lead_id` CHAR(36) NOT NULL,
    `kind` ENUM('INFO_ADDED', 'MORE_INFO_REQUESTED', 'CONVERSION_SNAPSHOT') NOT NULL,
    `note` VARCHAR(2000) NULL,
    `verified_title` VARCHAR(200) NULL,
    `verified_description` TEXT NULL,
    `demand_type` ENUM('TECHNICAL', 'TALENT', 'PROJECT', 'OTHER') NULL,
    `urgency` ENUM('NORMAL', 'URGENT') NULL,
    `selected_contact_id` CHAR(36) NULL,
    `created_by_person_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `demand_lead_supplements_demand_lead_id_created_at_idx`(`demand_lead_id`, `created_at`),
    INDEX `demand_lead_supplements_created_by_person_id_created_at_idx`(`created_by_person_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demand_lead_public_idempotency` (
    `id` CHAR(36) NOT NULL,
    `idempotency_key_hash` CHAR(64) NOT NULL,
    `payload_hash` CHAR(64) NOT NULL,
    `demand_lead_id` CHAR(36) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `demand_lead_public_idempotency_idempotency_key_hash_key`(`idempotency_key_hash`),
    INDEX `demand_lead_public_idempotency_demand_lead_id_created_at_idx`(`demand_lead_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demand_provenances` (
    `id` CHAR(36) NOT NULL,
    `demand_id` CHAR(36) NOT NULL,
    `source_type` ENUM('DEMAND_LEAD') NOT NULL,
    `demand_lead_id` CHAR(36) NULL,
    `source_snapshot` JSON NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `demand_provenances_demand_lead_id_key`(`demand_lead_id`),
    INDEX `demand_provenances_demand_id_created_at_idx`(`demand_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `demand_contact_snapshots` (
    `id` CHAR(36) NOT NULL,
    `demand_id` CHAR(36) NOT NULL,
    `enterprise_name` VARCHAR(200) NOT NULL,
    `contact_name` VARCHAR(80) NOT NULL,
    `contact_position` VARCHAR(100) NULL,
    `contact_phone` VARCHAR(30) NOT NULL,
    `snapshot_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `demand_contact_snapshots_demand_id_key`(`demand_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Indexes and foreign keys for public attachment ownership.
CREATE UNIQUE INDEX `attachments_public_upload_token_hash_key` ON `attachments`(`public_upload_token_hash`);
CREATE INDEX `attachments_public_area_id_is_temporary_upload_status_idx` ON `attachments`(`public_area_id`, `is_temporary`, `upload_status`);
ALTER TABLE `attachments` ADD CONSTRAINT `attachments_public_area_id_fkey` FOREIGN KEY (`public_area_id`) REFERENCES `administrative_areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `demands` ADD CONSTRAINT `demands_enterprise_id_fkey` FOREIGN KEY (`enterprise_id`) REFERENCES `enterprises`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demands` ADD CONSTRAINT `demands_responsible_area_id_fkey` FOREIGN KEY (`responsible_area_id`) REFERENCES `administrative_areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demands` ADD CONSTRAINT `demands_selected_contact_id_fkey` FOREIGN KEY (`selected_contact_id`) REFERENCES `enterprise_contacts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demands` ADD CONSTRAINT `demands_creation_batch_id_fkey` FOREIGN KEY (`creation_batch_id`) REFERENCES `batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demands` ADD CONSTRAINT `demands_current_follow_batch_id_fkey` FOREIGN KEY (`current_follow_batch_id`) REFERENCES `batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demands` ADD CONSTRAINT `demands_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `demand_leads` ADD CONSTRAINT `demand_leads_responsible_area_id_fkey` FOREIGN KEY (`responsible_area_id`) REFERENCES `administrative_areas`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demand_leads` ADD CONSTRAINT `demand_leads_enterprise_id_fkey` FOREIGN KEY (`enterprise_id`) REFERENCES `enterprises`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demand_leads` ADD CONSTRAINT `demand_leads_source_person_id_fkey` FOREIGN KEY (`source_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demand_leads` ADD CONSTRAINT `demand_leads_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demand_leads` ADD CONSTRAINT `demand_leads_converted_demand_id_fkey` FOREIGN KEY (`converted_demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demand_leads` ADD CONSTRAINT `demand_leads_merged_into_lead_id_fkey` FOREIGN KEY (`merged_into_lead_id`) REFERENCES `demand_leads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `demand_lead_supplements` ADD CONSTRAINT `demand_lead_supplements_demand_lead_id_fkey` FOREIGN KEY (`demand_lead_id`) REFERENCES `demand_leads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demand_lead_supplements` ADD CONSTRAINT `demand_lead_supplements_selected_contact_id_fkey` FOREIGN KEY (`selected_contact_id`) REFERENCES `enterprise_contacts`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demand_lead_supplements` ADD CONSTRAINT `demand_lead_supplements_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `demand_lead_public_idempotency` ADD CONSTRAINT `demand_lead_public_idempotency_demand_lead_id_fkey` FOREIGN KEY (`demand_lead_id`) REFERENCES `demand_leads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demand_provenances` ADD CONSTRAINT `demand_provenances_demand_id_fkey` FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demand_provenances` ADD CONSTRAINT `demand_provenances_demand_lead_id_fkey` FOREIGN KEY (`demand_lead_id`) REFERENCES `demand_leads`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `demand_contact_snapshots` ADD CONSTRAINT `demand_contact_snapshots_demand_id_fkey` FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Immutable source snapshots: no application path may overwrite the original submission.
CREATE TRIGGER `demand_leads_source_immutable`
BEFORE UPDATE ON `demand_leads`
FOR EACH ROW
BEGIN
  IF NOT (OLD.`source_type` <=> NEW.`source_type`)
    OR NOT (OLD.`raw_enterprise_name` <=> NEW.`raw_enterprise_name`)
    OR NOT (OLD.`raw_contact_name` <=> NEW.`raw_contact_name`)
    OR NOT (OLD.`raw_contact_phone` <=> NEW.`raw_contact_phone`)
    OR NOT (OLD.`raw_title` <=> NEW.`raw_title`)
    OR NOT (OLD.`raw_content` <=> NEW.`raw_content`)
    OR NOT (OLD.`source_person_id` <=> NEW.`source_person_id`)
    OR NOT (OLD.`source_channel` <=> NEW.`source_channel`)
    OR NOT (OLD.`source_at` <=> NEW.`source_at`)
    OR NOT (OLD.`trip_id` <=> NEW.`trip_id`)
    OR NOT (OLD.`visit_id` <=> NEW.`visit_id`) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEMAND_LEAD_SOURCE_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER `demand_lead_original_attachment_no_delete`
BEFORE DELETE ON `attachment_links`
FOR EACH ROW
BEGIN
  IF OLD.`entity_type` = 'DEMAND_LEAD' AND OLD.`relation_type` = 'ORIGINAL' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEMAND_LEAD_ORIGINAL_ATTACHMENT_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER `demand_lead_original_attachment_no_update`
BEFORE UPDATE ON `attachment_links`
FOR EACH ROW
BEGIN
  IF OLD.`entity_type` = 'DEMAND_LEAD' AND OLD.`relation_type` = 'ORIGINAL' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEMAND_LEAD_ORIGINAL_ATTACHMENT_IMMUTABLE';
  END IF;
END;
