-- B-M3-001 Reimbursement is expand-only. It adds the private reimbursement
-- workflow, immutable submission snapshots, invoice OCR and asynchronous export.

CREATE TABLE `reimbursements` (
  `id` CHAR(36) NOT NULL,
  `business_no` VARCHAR(32) NOT NULL,
  `applicant_person_id` CHAR(36) NOT NULL,
  `type` ENUM('TRAVEL', 'ACTIVITY') NOT NULL,
  `reason` VARCHAR(2000) NOT NULL,
  `linked_trip_id` CHAR(36) NULL,
  `status` ENUM('DRAFT', 'PENDING_ONLINE_REVIEW', 'RETURNED', 'VERIFIED_PENDING_PAPER', 'PAPER_RECEIVED', 'FINANCE_SUBMITTED') NOT NULL DEFAULT 'DRAFT',
  `current_submission_version_id` CHAR(36) NULL,
  `total_amount` DECIMAL(18,2) NOT NULL DEFAULT 0,
  `first_submitted_at` DATETIME(3) NULL,
  `last_submitted_at` DATETIME(3) NULL,
  `paper_received_at` DATETIME(3) NULL,
  `paper_received_by_person_id` CHAR(36) NULL,
  `finance_submitted_at` DATETIME(3) NULL,
  `finance_submitted_by_person_id` CHAR(36) NULL,
  `source_system` VARCHAR(50) NOT NULL DEFAULT 'V2',
  `source_record_id` VARCHAR(191) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `reimbursements_business_no_key` (`business_no`),
  UNIQUE INDEX `reimbursements_current_submission_version_id_key` (`current_submission_version_id`),
  UNIQUE INDEX `reimbursements_source_system_source_record_id_key` (`source_system`, `source_record_id`),
  INDEX `reimbursements_applicant_person_id_created_at_idx` (`applicant_person_id`, `created_at`),
  INDEX `reimbursements_status_updated_at_idx` (`status`, `updated_at`),
  INDEX `reimbursements_linked_trip_id_idx` (`linked_trip_id`),
  INDEX `reimbursements_paper_received_by_person_id_idx` (`paper_received_by_person_id`),
  INDEX `reimbursements_finance_submitted_by_person_id_idx` (`finance_submitted_by_person_id`),
  CONSTRAINT `reimbursements_amount_check` CHECK (`total_amount` >= 0),
  CONSTRAINT `reimbursements_submission_shape_check` CHECK (
    (`status` = 'DRAFT') OR
    (`current_submission_version_id` IS NOT NULL AND `first_submitted_at` IS NOT NULL AND `last_submitted_at` IS NOT NULL)
  ),
  CONSTRAINT `reimbursements_paper_shape_check` CHECK (
    (`status` NOT IN ('PAPER_RECEIVED', 'FINANCE_SUBMITTED')) OR
    (`paper_received_at` IS NOT NULL AND `paper_received_by_person_id` IS NOT NULL)
  ),
  CONSTRAINT `reimbursements_finance_shape_check` CHECK (
    (`status` <> 'FINANCE_SUBMITTED') OR
    (`finance_submitted_at` IS NOT NULL AND `finance_submitted_by_person_id` IS NOT NULL)
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `reimbursement_submission_versions` (
  `id` CHAR(36) NOT NULL,
  `reimbursement_id` CHAR(36) NOT NULL,
  `version_no` INT UNSIGNED NOT NULL,
  `reason_snapshot` VARCHAR(2000) NOT NULL,
  `trip_snapshot_json` JSON NULL,
  `expense_snapshot_json` JSON NOT NULL,
  `invoice_snapshot_json` JSON NOT NULL,
  `total_amount` DECIMAL(18,2) NOT NULL,
  `submitted_by_person_id` CHAR(36) NOT NULL,
  `submitted_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `reimbursement_version_no_key` (`reimbursement_id`, `version_no`),
  INDEX `reimbursement_version_submitter_idx` (`submitted_by_person_id`, `submitted_at`),
  CONSTRAINT `reimbursement_submission_amount_check` CHECK (`total_amount` >= 0)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `reimbursement_invoices` (
  `id` CHAR(36) NOT NULL,
  `reimbursement_id` CHAR(36) NOT NULL,
  `attachment_id` CHAR(36) NOT NULL,
  `ocr_status` ENUM('NOT_REQUESTED', 'QUEUED', 'PROCESSING', 'READY', 'DEGRADED', 'FAILED', 'CONFIRMED') NOT NULL DEFAULT 'NOT_REQUESTED',
  `suggested_expense_type` ENUM('TRAVEL_TRANSPORT_ACTUAL', 'TRAVEL_TRANSPORT_SUBSIDY', 'TRAVEL_MEAL_SUBSIDY', 'TRAVEL_LODGING', 'DINING', 'VENUE', 'MATERIAL_PRODUCTION', 'SUPPLIES', 'LODGING', 'TRANSPORTATION', 'OTHER') NULL,
  `ocr_raw_json` JSON NULL,
  `ocr_warning` VARCHAR(500) NULL,
  `confirmed_expense_type` ENUM('TRAVEL_TRANSPORT_ACTUAL', 'TRAVEL_TRANSPORT_SUBSIDY', 'TRAVEL_MEAL_SUBSIDY', 'TRAVEL_LODGING', 'DINING', 'VENUE', 'MATERIAL_PRODUCTION', 'SUPPLIES', 'LODGING', 'TRANSPORTATION', 'OTHER') NULL,
  `confirmed_invoice_date` DATE NULL,
  `confirmed_amount` DECIMAL(18,2) NULL,
  `confirmed_seller` VARCHAR(300) NULL,
  `confirmed_invoice_no` VARCHAR(100) NULL,
  `invoice_no_normalized` VARCHAR(100) NULL,
  `confirmed_at` DATETIME(3) NULL,
  `confirmed_by_person_id` CHAR(36) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `reimbursement_invoices_attachment_id_key` (`attachment_id`),
  INDEX `reimbursement_invoices_reimbursement_id_created_at_idx` (`reimbursement_id`, `created_at`),
  INDEX `reimbursement_invoices_invoice_no_normalized_idx` (`invoice_no_normalized`),
  INDEX `reimbursement_invoices_ocr_status_updated_at_idx` (`ocr_status`, `updated_at`),
  CONSTRAINT `reimbursement_invoice_amount_check` CHECK (`confirmed_amount` IS NULL OR `confirmed_amount` >= 0),
  CONSTRAINT `reimbursement_invoice_confirmed_shape_check` CHECK (
    (`ocr_status` <> 'CONFIRMED') OR
    (`confirmed_at` IS NOT NULL AND `confirmed_by_person_id` IS NOT NULL AND `confirmed_expense_type` IS NOT NULL)
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `reimbursement_expenses` (
  `id` CHAR(36) NOT NULL,
  `reimbursement_id` CHAR(36) NOT NULL,
  `expense_type` ENUM('TRAVEL_TRANSPORT_ACTUAL', 'TRAVEL_TRANSPORT_SUBSIDY', 'TRAVEL_MEAL_SUBSIDY', 'TRAVEL_LODGING', 'DINING', 'VENUE', 'MATERIAL_PRODUCTION', 'SUPPLIES', 'LODGING', 'TRANSPORTATION', 'OTHER') NOT NULL,
  `custom_expense_name` VARCHAR(200) NULL,
  `description` VARCHAR(1000) NULL,
  `expense_date` DATE NULL,
  `amount` DECIMAL(18,2) NOT NULL,
  `invoice_id` CHAR(36) NULL,
  `source` ENUM('MANUAL', 'OCR') NOT NULL DEFAULT 'MANUAL',
  `reference_rate` DECIMAL(18,2) NULL,
  `claimed_days` DECIMAL(8,2) NULL,
  `calculation_note` VARCHAR(1000) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  INDEX `reimbursement_expense_active_type_idx` (`reimbursement_id`, `is_active`, `expense_type`),
  INDEX `reimbursement_expenses_invoice_id_idx` (`invoice_id`),
  CONSTRAINT `reimbursement_expense_amount_check` CHECK (`amount` >= 0),
  CONSTRAINT `reimbursement_expense_other_name_check` CHECK (`expense_type` <> 'OTHER' OR `custom_expense_name` IS NOT NULL),
  CONSTRAINT `reimbursement_expense_subsidy_check` CHECK (
    (`expense_type` = 'TRAVEL_TRANSPORT_SUBSIDY' AND `reference_rate` = 80.00 AND `claimed_days` > 0 AND `source` = 'MANUAL') OR
    (`expense_type` = 'TRAVEL_MEAL_SUBSIDY' AND `reference_rate` = 100.00 AND `claimed_days` > 0 AND `source` = 'MANUAL') OR
    (`expense_type` NOT IN ('TRAVEL_TRANSPORT_SUBSIDY', 'TRAVEL_MEAL_SUBSIDY') AND `reference_rate` IS NULL AND `claimed_days` IS NULL)
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `reimbursement_command_idempotencies` (
  `id` CHAR(36) NOT NULL,
  `reimbursement_id` CHAR(36) NOT NULL,
  `actor_person_id` CHAR(36) NOT NULL,
  `idempotency_key_hash` CHAR(64) NOT NULL,
  `payload_hash` CHAR(64) NOT NULL,
  `response_json` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `reimbursement_submit_idempotency_key` (`actor_person_id`, `idempotency_key_hash`),
  INDEX `reimbursement_command_parent_idx` (`reimbursement_id`, `created_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `reimbursement_export_tasks` (
  `id` CHAR(36) NOT NULL,
  `created_by_person_id` CHAR(36) NOT NULL,
  `required_permission` VARCHAR(100) NOT NULL DEFAULT 'reimbursement.manage',
  `reimbursement_ids_json` JSON NOT NULL,
  `format` ENUM('XLSX', 'PDF') NOT NULL,
  `status` ENUM('WAITING', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'WAITING',
  `output_attachment_id` CHAR(36) NULL,
  `error_code` VARCHAR(100) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `started_at` DATETIME(3) NULL,
  `finished_at` DATETIME(3) NULL,
  `expires_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `reimbursement_export_tasks_created_by_person_id_created_at_idx` (`created_by_person_id`, `created_at`),
  INDEX `reimbursement_export_tasks_status_created_at_idx` (`status`, `created_at`),
  INDEX `reimbursement_export_tasks_output_attachment_id_idx` (`output_attachment_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `reimbursements` ADD CONSTRAINT `reimbursements_applicant_person_id_fkey` FOREIGN KEY (`applicant_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursements` ADD CONSTRAINT `reimbursements_linked_trip_id_fkey` FOREIGN KEY (`linked_trip_id`) REFERENCES `trips` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursements` ADD CONSTRAINT `reimbursements_paper_received_by_person_id_fkey` FOREIGN KEY (`paper_received_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursements` ADD CONSTRAINT `reimbursements_finance_submitted_by_person_id_fkey` FOREIGN KEY (`finance_submitted_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursement_submission_versions` ADD CONSTRAINT `reimbursement_versions_reimbursement_id_fkey` FOREIGN KEY (`reimbursement_id`) REFERENCES `reimbursements` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursement_submission_versions` ADD CONSTRAINT `reimbursement_versions_submitted_by_person_id_fkey` FOREIGN KEY (`submitted_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursements` ADD CONSTRAINT `reimbursements_current_submission_version_id_fkey` FOREIGN KEY (`current_submission_version_id`) REFERENCES `reimbursement_submission_versions` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursement_invoices` ADD CONSTRAINT `reimbursement_invoices_reimbursement_id_fkey` FOREIGN KEY (`reimbursement_id`) REFERENCES `reimbursements` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursement_invoices` ADD CONSTRAINT `reimbursement_invoices_attachment_id_fkey` FOREIGN KEY (`attachment_id`) REFERENCES `attachments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursement_invoices` ADD CONSTRAINT `reimbursement_invoices_confirmed_by_person_id_fkey` FOREIGN KEY (`confirmed_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursement_expenses` ADD CONSTRAINT `reimbursement_expenses_reimbursement_id_fkey` FOREIGN KEY (`reimbursement_id`) REFERENCES `reimbursements` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursement_expenses` ADD CONSTRAINT `reimbursement_expenses_invoice_id_fkey` FOREIGN KEY (`invoice_id`) REFERENCES `reimbursement_invoices` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursement_command_idempotencies` ADD CONSTRAINT `reimbursement_command_reimbursement_id_fkey` FOREIGN KEY (`reimbursement_id`) REFERENCES `reimbursements` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursement_command_idempotencies` ADD CONSTRAINT `reimbursement_command_actor_person_id_fkey` FOREIGN KEY (`actor_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursement_export_tasks` ADD CONSTRAINT `reimbursement_export_created_by_person_id_fkey` FOREIGN KEY (`created_by_person_id`) REFERENCES `persons` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `reimbursement_export_tasks` ADD CONSTRAINT `reimbursement_export_output_attachment_id_fkey` FOREIGN KEY (`output_attachment_id`) REFERENCES `attachments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
