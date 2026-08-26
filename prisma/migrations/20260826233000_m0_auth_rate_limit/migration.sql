-- CreateTable
CREATE TABLE `auth_rate_limit_buckets` (
    `id` CHAR(36) NOT NULL,
    `dimension` ENUM('PHONE', 'IP', 'DEVICE') NOT NULL,
    `key_hash` CHAR(64) NOT NULL,
    `window_start` DATETIME(3) NOT NULL,
    `attempt_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `blocked_until` DATETIME(3) NULL,
    `last_logged_at` DATETIME(3) NULL,
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `auth_rate_limit_buckets_dimension_key_hash_key`(`dimension`, `key_hash`),
    INDEX `auth_rate_limit_buckets_blocked_until_idx`(`blocked_until`),
    INDEX `auth_rate_limit_buckets_updated_at_idx`(`updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
