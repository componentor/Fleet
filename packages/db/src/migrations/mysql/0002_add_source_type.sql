ALTER TABLE `services` ADD COLUMN `source_type` varchar(20);
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `source_path` varchar(500);
--> statement-breakpoint
-- Add soft delete columns (missing from initial MySQL schema)
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
