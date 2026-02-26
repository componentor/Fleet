CREATE TABLE IF NOT EXISTS `registry_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL REFERENCES `accounts`(`id`) ON DELETE CASCADE,
	`registry` text NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_registry_credentials_account_id` ON `registry_credentials` (`account_id`);
