-- Add missing columns to services table
ALTER TABLE `services` ADD COLUMN `dockerfile` text;--> statement-breakpoint

-- Add missing columns to deployments table
ALTER TABLE `deployments` ADD COLUMN `notes` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD COLUMN `progress_step` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD COLUMN `trigger` text;--> statement-breakpoint
ALTER TABLE `deployments` ADD COLUMN `started_at` integer;--> statement-breakpoint
ALTER TABLE `deployments` ADD COLUMN `completed_at` integer;--> statement-breakpoint

-- Add missing column to subscriptions table
ALTER TABLE `subscriptions` ADD COLUMN `past_due_since` integer;--> statement-breakpoint

-- Add missing indexes
CREATE INDEX IF NOT EXISTS `idx_services_github_autodeploy` ON `services` (`github_repo`, `github_branch`, `auto_deploy`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_subscriptions_account_id` ON `subscriptions` (`account_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_subscriptions_status` ON `subscriptions` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_deployments_status` ON `deployments` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_usage_records_account_id` ON `usage_records` (`account_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_api_keys_account_id` ON `api_keys` (`account_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_backups_account_id` ON `backups` (`account_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_backups_service_id` ON `backups` (`service_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_backup_schedules_account_id` ON `backup_schedules` (`account_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_backup_schedules_service_id` ON `backup_schedules` (`service_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_notifications_user_id` ON `notifications` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ssh_keys_user_id` ON `ssh_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_ssh_access_rules_service_id` ON `ssh_access_rules` (`service_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_email_log_status` ON `email_log` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_error_log_level` ON `error_log` (`level`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_error_log_resolved` ON `error_log` (`resolved`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_node_metrics_node_recorded` ON `node_metrics` (`node_id`, `recorded_at`);
