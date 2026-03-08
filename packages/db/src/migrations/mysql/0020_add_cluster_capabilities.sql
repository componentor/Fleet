-- Add allowServices and allowBackups capability flags to storage_clusters
ALTER TABLE `storage_clusters` ADD COLUMN `allow_services` boolean DEFAULT true NOT NULL;
--> statement-breakpoint
ALTER TABLE `storage_clusters` ADD COLUMN `allow_backups` boolean DEFAULT true NOT NULL;
