ALTER TABLE `audit_log` ADD COLUMN `event_type` varchar(255);
--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `description` varchar(500);
--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `resource_name` varchar(255);
--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `actor_email` varchar(255);
--> statement-breakpoint
ALTER TABLE `audit_log` ADD COLUMN `source` varchar(50) DEFAULT 'user';
--> statement-breakpoint
CREATE INDEX `idx_audit_log_event_type` ON `audit_log` (`event_type`);
