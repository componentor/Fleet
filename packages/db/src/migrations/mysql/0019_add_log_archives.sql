-- Track archived audit_log and error_log entries as compressed .tar.gz files
CREATE TABLE IF NOT EXISTS `log_archives` (
  `id` varchar(36) PRIMARY KEY,
  `log_type` varchar(50) NOT NULL,
  `account_id` varchar(36),
  `date_from` timestamp NOT NULL,
  `date_to` timestamp NOT NULL,
  `record_count` int NOT NULL DEFAULT 0,
  `size_bytes` bigint DEFAULT 0,
  `file_path` varchar(500) NOT NULL,
  `filename` varchar(255) NOT NULL,
  `status` varchar(50) DEFAULT 'completed',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `expires_at` timestamp NULL
);

--> statement-breakpoint
CREATE INDEX `idx_log_archives_log_type` ON `log_archives` (`log_type`);
--> statement-breakpoint
CREATE INDEX `idx_log_archives_account_id` ON `log_archives` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_log_archives_created_at` ON `log_archives` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_log_archives_expires_at` ON `log_archives` (`expires_at`);
