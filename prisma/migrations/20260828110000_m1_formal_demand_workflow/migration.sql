-- Expand the existing provenance vocabulary. V1 migration and formal-demand
-- merge remain reserved values only; this migration does not implement either flow.
ALTER TABLE `demand_provenances`
  MODIFY `source_type` ENUM(
    'TOWNSHIP_DIRECT',
    'ADMIN_DIRECT',
    'DEMAND_LEAD',
    'V1_MIGRATION',
    'MERGED_SOURCE'
  ) NOT NULL;

-- Expand the existing Demand record instead of introducing a second draft or
-- formal-demand aggregate.
ALTER TABLE `demands`
  ADD COLUMN `submitted_at` DATETIME(3) NULL,
  ADD COLUMN `reviewed_at` DATETIME(3) NULL,
  ADD COLUMN `reviewed_by_person_id` CHAR(36) NULL,
  ADD COLUMN `published_by_person_id` CHAR(36) NULL,
  ADD INDEX `demands_current_follow_batch_id_status_idx` (`current_follow_batch_id`, `status`),
  ADD INDEX `demands_status_first_published_at_idx` (`status`, `first_published_at`),
  ADD INDEX `demands_reviewed_by_person_id_reviewed_at_idx` (`reviewed_by_person_id`, `reviewed_at`),
  ADD INDEX `demands_published_by_person_id_first_published_at_idx` (`published_by_person_id`, `first_published_at`);

CREATE TABLE `demand_reviews` (
  `id` CHAR(36) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `decision` ENUM('APPROVE', 'RETURN') NOT NULL,
  `return_reason` VARCHAR(500) NULL,
  `reviewer_person_id` CHAR(36) NOT NULL,
  `demand_type_before` ENUM('TECHNICAL', 'TALENT', 'PROJECT', 'OTHER') NOT NULL,
  `demand_type_after` ENUM('TECHNICAL', 'TALENT', 'PROJECT', 'OTHER') NOT NULL,
  `urgency_before` ENUM('NORMAL', 'URGENT') NOT NULL,
  `urgency_after` ENUM('NORMAL', 'URGENT') NOT NULL,
  `reviewed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  CONSTRAINT `demand_reviews_return_reason_check` CHECK (
    (`decision` = 'RETURN' AND `return_reason` IS NOT NULL AND CHAR_LENGTH(TRIM(`return_reason`)) > 0)
    OR (`decision` = 'APPROVE' AND `return_reason` IS NULL)
  ),
  INDEX `demand_reviews_demand_id_reviewed_at_idx` (`demand_id`, `reviewed_at`),
  INDEX `demand_reviews_reviewer_person_id_reviewed_at_idx` (`reviewer_person_id`, `reviewed_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `demand_command_idempotency` (
  `id` CHAR(36) NOT NULL,
  `actor_person_id` CHAR(36) NOT NULL,
  `action` VARCHAR(100) NOT NULL,
  `key_hash` CHAR(64) NOT NULL,
  `payload_hash` CHAR(64) NOT NULL,
  `demand_id` CHAR(36) NOT NULL,
  `response_json` JSON NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

  UNIQUE INDEX `demand_command_idempotency_actor_person_id_action_key_hash_key` (`actor_person_id`, `action`, `key_hash`),
  INDEX `demand_command_idempotency_demand_id_created_at_idx` (`demand_id`, `created_at`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `demands`
  ADD CONSTRAINT `demands_reviewed_by_person_id_fkey`
    FOREIGN KEY (`reviewed_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demands_published_by_person_id_fkey`
    FOREIGN KEY (`published_by_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `demand_reviews`
  ADD CONSTRAINT `demand_reviews_demand_id_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_reviews_reviewer_person_id_fkey`
    FOREIGN KEY (`reviewer_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `demand_command_idempotency`
  ADD CONSTRAINT `demand_command_idempotency_actor_person_id_fkey`
    FOREIGN KEY (`actor_person_id`) REFERENCES `persons`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT `demand_command_idempotency_demand_id_fkey`
    FOREIGN KEY (`demand_id`) REFERENCES `demands`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- Provenance is append-only history. Future flows may append a new source row,
-- but no command may rewrite an existing source, snapshot, or parent link.
CREATE TRIGGER `demand_provenance_no_update`
BEFORE UPDATE ON `demand_provenances`
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEMAND_PROVENANCE_IMMUTABLE';
END;

-- first_published_at is a permanent first-publication fact. Core fields are
-- immutable once the old row is already on the published side of the boundary.
CREATE TRIGGER `demand_published_core_immutable`
BEFORE UPDATE ON `demands`
FOR EACH ROW
BEGIN
  IF OLD.`first_published_at` IS NOT NULL
    AND NOT (OLD.`first_published_at` <=> NEW.`first_published_at`) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEMAND_FIRST_PUBLISHED_AT_IMMUTABLE';
  END IF;

  IF OLD.`status` IN (
      'PENDING_CLAIM', 'IN_PROGRESS', 'PENDING_CLOSE_REVIEW',
      'COMPLETED', 'CANCELED', 'MERGED'
    ) AND (
      NOT (OLD.`enterprise_id` <=> NEW.`enterprise_id`)
      OR NOT (OLD.`selected_contact_id` <=> NEW.`selected_contact_id`)
      OR NOT (OLD.`title` <=> NEW.`title`)
      OR NOT (OLD.`original_description` <=> NEW.`original_description`)
      OR NOT (OLD.`responsible_area_id` <=> NEW.`responsible_area_id`)
    ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEMAND_PUBLISHED_CORE_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER `demand_contact_snapshot_published_no_update`
BEFORE UPDATE ON `demand_contact_snapshots`
FOR EACH ROW
BEGIN
  DECLARE demand_status VARCHAR(40);
  SELECT `status` INTO demand_status FROM `demands` WHERE `id` = OLD.`demand_id`;
  IF demand_status IN (
      'PENDING_CLAIM', 'IN_PROGRESS', 'PENDING_CLOSE_REVIEW',
      'COMPLETED', 'CANCELED', 'MERGED'
    ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEMAND_PUBLISHED_SNAPSHOT_IMMUTABLE';
  END IF;
END;

-- SOURCE_REFERENCE is permanent. FORMAL_ATTACHMENT may be replaced only while
-- the object is an editable DRAFT/RETURNED record; PENDING_REVIEW freezes it.
CREATE TRIGGER `demand_attachment_link_no_delete`
BEFORE DELETE ON `attachment_links`
FOR EACH ROW
BEGIN
  DECLARE demand_status VARCHAR(40);
  IF OLD.`entity_type` = 'DEMAND' AND OLD.`relation_type` = 'SOURCE_REFERENCE' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEMAND_SOURCE_ATTACHMENT_IMMUTABLE';
  END IF;
  IF OLD.`entity_type` = 'DEMAND' AND OLD.`relation_type` = 'FORMAL_ATTACHMENT' THEN
    SELECT `status` INTO demand_status FROM `demands` WHERE `id` = OLD.`entity_id`;
    IF demand_status NOT IN ('DRAFT', 'RETURNED') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEMAND_ATTACHMENT_SET_FROZEN';
    END IF;
  END IF;
END;

CREATE TRIGGER `demand_attachment_link_no_update`
BEFORE UPDATE ON `attachment_links`
FOR EACH ROW
BEGIN
  IF OLD.`entity_type` = 'DEMAND'
    AND OLD.`relation_type` IN ('SOURCE_REFERENCE', 'FORMAL_ATTACHMENT') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEMAND_ATTACHMENT_LINK_IMMUTABLE';
  END IF;
END;

CREATE TRIGGER `demand_attachment_link_insert_guard`
BEFORE INSERT ON `attachment_links`
FOR EACH ROW
BEGIN
  DECLARE demand_status VARCHAR(40);
  IF NEW.`entity_type` = 'DEMAND'
    AND NEW.`relation_type` IN ('SOURCE_REFERENCE', 'FORMAL_ATTACHMENT') THEN
    SELECT `status` INTO demand_status FROM `demands` WHERE `id` = NEW.`entity_id`;
    IF demand_status NOT IN ('DRAFT', 'RETURNED') THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DEMAND_ATTACHMENT_SET_FROZEN';
    END IF;
  END IF;
END;
