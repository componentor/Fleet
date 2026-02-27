ALTER TABLE `error_log` ADD COLUMN `status` varchar(50) DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE `error_log` ADD COLUMN `self_healing_job_id` varchar(36);
--> statement-breakpoint
UPDATE `error_log` SET `status` = 'resolved' WHERE `resolved` = true AND (`status` IS NULL OR `status` = 'open');
--> statement-breakpoint
CREATE INDEX `idx_error_log_status` ON `error_log` (`status`);
