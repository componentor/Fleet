-- Add region to services for placement constraints
ALTER TABLE `services` ADD COLUMN `region` text;
--> statement-breakpoint
-- Add multi-cluster fields to storage_clusters
ALTER TABLE `storage_clusters` ADD COLUMN `name` text DEFAULT 'default' NOT NULL;
--> statement-breakpoint
ALTER TABLE `storage_clusters` ADD COLUMN `region` text;
--> statement-breakpoint
ALTER TABLE `storage_clusters` ADD COLUMN `scope` text DEFAULT 'regional' NOT NULL;
--> statement-breakpoint
-- Add cluster_id FK to storage_volumes
ALTER TABLE `storage_volumes` ADD COLUMN `cluster_id` text REFERENCES `storage_clusters`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
-- Add index for last_health_check on storage_nodes
CREATE INDEX IF NOT EXISTS `idx_storage_nodes_last_health_check` ON `storage_nodes` (`last_health_check`);
--> statement-breakpoint
-- Add index for deleted_at on storage_volumes
CREATE INDEX IF NOT EXISTS `idx_storage_volumes_deleted_at` ON `storage_volumes` (`deleted_at`);
--> statement-breakpoint
-- Backfill: link existing volumes to their cluster (the only cluster that existed pre-migration)
UPDATE `storage_volumes` SET `cluster_id` = (SELECT `id` FROM `storage_clusters` LIMIT 1) WHERE `cluster_id` IS NULL;
