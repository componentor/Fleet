-- Add incremental backup columns to backups table
ALTER TABLE `backups` ADD COLUMN `parent_id` varchar(36);
ALTER TABLE `backups` ADD COLUMN `level` int DEFAULT 0;
ALTER TABLE `backups` ADD COLUMN `cluster_id` varchar(36);
CREATE INDEX `idx_backups_parent_id` ON `backups` (`parent_id`);

-- Add cluster_id to backup_schedules
ALTER TABLE `backup_schedules` ADD COLUMN `cluster_id` varchar(36);

-- Add backup quota and cluster override to resource_limits
ALTER TABLE `resource_limits` ADD COLUMN `max_container_disk_mb` int;
ALTER TABLE `resource_limits` ADD COLUMN `max_backup_storage_gb` int;
ALTER TABLE `resource_limits` ADD COLUMN `backup_cluster_id` varchar(36);
