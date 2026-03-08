-- Add incremental backup columns to backups table
ALTER TABLE `backups` ADD COLUMN `parent_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `backups` ADD COLUMN `level` int DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `backups` ADD COLUMN `cluster_id` varchar(36);
--> statement-breakpoint
CREATE INDEX `idx_backups_parent_id` ON `backups` (`parent_id`);

-- Add cluster_id to backup_schedules
--> statement-breakpoint
ALTER TABLE `backup_schedules` ADD COLUMN `cluster_id` varchar(36);

-- Add backup quota and cluster override to resource_limits
--> statement-breakpoint
ALTER TABLE `resource_limits` ADD COLUMN `max_container_disk_mb` int;
--> statement-breakpoint
ALTER TABLE `resource_limits` ADD COLUMN `max_backup_storage_gb` int;
--> statement-breakpoint
ALTER TABLE `resource_limits` ADD COLUMN `backup_cluster_id` varchar(36);
