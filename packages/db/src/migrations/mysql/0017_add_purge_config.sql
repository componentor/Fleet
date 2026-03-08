ALTER TABLE `billing_config` ADD `purge_enabled` boolean DEFAULT true;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD `purge_retention_days` int DEFAULT 30;
