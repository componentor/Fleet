-- Add scheduled deletion support for accounts
ALTER TABLE `accounts` ADD COLUMN `scheduled_deletion_at` timestamp NULL;
--> statement-breakpoint
-- Add soft delete columns
ALTER TABLE `accounts` ADD COLUMN `deleted_at` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `deleted_at` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `deleted_at` timestamp NULL;
--> statement-breakpoint
-- Add missing user columns (auth, 2FA, password reset)
ALTER TABLE `users` ADD COLUMN `email_verified` boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `email_verify_token` varchar(255);
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `email_verify_expires` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `password_reset_token` varchar(255);
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `password_reset_expires` timestamp NULL;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `two_factor_enabled` boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `two_factor_secret` varchar(255);
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `two_factor_backup_codes` json;
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `security_changed_at` timestamp NULL;
--> statement-breakpoint
-- Add unique constraint on subscriptions.stripe_subscription_id
ALTER TABLE `subscriptions` ADD UNIQUE (`stripe_subscription_id`);
--> statement-breakpoint
-- Add stack grouping for services
ALTER TABLE `services` ADD COLUMN `stack_id` varchar(36) NULL;
--> statement-breakpoint
CREATE INDEX `idx_services_stack_id` ON `services` (`stack_id`);
