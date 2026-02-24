-- Add configurable grace period settings to billing_config
ALTER TABLE `billing_config` ADD COLUMN `suspension_grace_days` integer DEFAULT 7;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `deletion_grace_days` integer DEFAULT 14;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `auto_suspend_enabled` integer DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `auto_delete_enabled` integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `suspension_warning_days` integer DEFAULT 2;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `deletion_warning_days` integer DEFAULT 7;
--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `volume_deletion_enabled` integer DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `accounts` ADD COLUMN `suspended_at` integer;
