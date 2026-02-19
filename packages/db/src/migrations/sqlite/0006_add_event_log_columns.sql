ALTER TABLE `audit_log` ADD COLUMN `event_type` text;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `description` text;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `resource_name` text;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `actor_email` text;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `source` text DEFAULT 'user';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_audit_log_event_type` ON `audit_log` (`event_type`);
