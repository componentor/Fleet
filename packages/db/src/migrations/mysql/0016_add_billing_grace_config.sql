-- Add configurable grace period settings to billing_config
ALTER TABLE `billing_config` ADD COLUMN `suspension_grace_days` int DEFAULT 7;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `deletion_grace_days` int DEFAULT 14;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `auto_suspend_enabled` boolean DEFAULT true;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `auto_delete_enabled` boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `suspension_warning_days` int DEFAULT 2;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `deletion_warning_days` int DEFAULT 7;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `volume_deletion_enabled` boolean DEFAULT true;
--> statement-breakpoint
ALTER TABLE `accounts` ADD COLUMN `suspended_at` timestamp;
