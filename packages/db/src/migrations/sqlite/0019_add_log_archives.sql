-- Track archived audit_log and error_log entries as compressed .tar.gz files
CREATE TABLE IF NOT EXISTS `log_archives` (
  `id` text PRIMARY KEY,
  `log_type` text NOT NULL,
  `account_id` text,
  `date_from` integer NOT NULL,
  `date_to` integer NOT NULL,
  `record_count` integer NOT NULL DEFAULT 0,
  `size_bytes` integer DEFAULT 0,
  `file_path` text NOT NULL,
  `filename` text NOT NULL,
  `status` text DEFAULT 'completed',
  `created_at` integer DEFAULT (unixepoch()),
  `expires_at` integer
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_log_archives_log_type` ON `log_archives` (`log_type`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_log_archives_account_id` ON `log_archives` (`account_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_log_archives_created_at` ON `log_archives` (`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_log_archives_expires_at` ON `log_archives` (`expires_at`);
