ALTER TABLE `billing_config` ADD `purge_enabled` integer DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD `purge_retention_days` integer DEFAULT 30;
