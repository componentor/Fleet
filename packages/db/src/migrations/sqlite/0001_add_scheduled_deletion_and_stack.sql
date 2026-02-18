-- Add scheduled deletion support for accounts
ALTER TABLE `accounts` ADD COLUMN `scheduled_deletion_at` integer;
--> statement-breakpoint
-- Add stack grouping for services
ALTER TABLE `services` ADD COLUMN `stack_id` text;
--> statement-breakpoint
CREATE INDEX `idx_services_stack_id` ON `services` (`stack_id`);
