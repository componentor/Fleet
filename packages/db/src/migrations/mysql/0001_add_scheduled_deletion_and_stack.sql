-- Add scheduled deletion support for accounts
ALTER TABLE `accounts` ADD COLUMN `scheduled_deletion_at` timestamp NULL;
--> statement-breakpoint
-- Add stack grouping for services
ALTER TABLE `services` ADD COLUMN `stack_id` varchar(36) NULL;
--> statement-breakpoint
CREATE INDEX `idx_services_stack_id` ON `services` (`stack_id`);
