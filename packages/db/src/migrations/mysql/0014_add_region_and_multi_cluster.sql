-- Add region to services for placement constraints
ALTER TABLE `services` ADD COLUMN `region` varchar(100);
--> statement-breakpoint
-- Add multi-cluster fields to storage_clusters
ALTER TABLE `storage_clusters` ADD COLUMN `name` varchar(255) DEFAULT 'default' NOT NULL;
--> statement-breakpoint
ALTER TABLE `storage_clusters` ADD COLUMN `region` varchar(100);
--> statement-breakpoint
ALTER TABLE `storage_clusters` ADD COLUMN `scope` varchar(20) DEFAULT 'regional' NOT NULL;
--> statement-breakpoint
-- Add cluster_id FK to storage_volumes
ALTER TABLE `storage_volumes` ADD COLUMN `cluster_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `storage_volumes` ADD CONSTRAINT `storage_volumes_cluster_id_fk` FOREIGN KEY (`cluster_id`) REFERENCES `storage_clusters`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
-- Add index for deleted_at on storage_volumes
CREATE INDEX `idx_storage_volumes_deleted_at` ON `storage_volumes` (`deleted_at`);
--> statement-breakpoint
-- Backfill: link existing volumes to their cluster (the only cluster that existed pre-migration)
UPDATE `storage_volumes` SET `cluster_id` = (SELECT `id` FROM `storage_clusters` LIMIT 1) WHERE `cluster_id` IS NULL;
