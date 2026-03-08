CREATE TABLE IF NOT EXISTS `storage_clusters` (
	`id` varchar(36) PRIMARY KEY NOT NULL,
	`provider` varchar(50) DEFAULT 'local' NOT NULL,
	`object_provider` varchar(50) DEFAULT 'local' NOT NULL,
	`status` varchar(20) DEFAULT 'inactive' NOT NULL,
	`replication_factor` int DEFAULT 3,
	`config` json DEFAULT ('{}'),
	`object_config` json DEFAULT ('{}'),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `storage_nodes` (
	`id` varchar(36) PRIMARY KEY NOT NULL,
	`cluster_id` varchar(36),
	`node_id` varchar(36),
	`hostname` varchar(255) NOT NULL,
	`ip_address` varchar(45) NOT NULL,
	`role` varchar(20) DEFAULT 'storage' NOT NULL,
	`status` varchar(20) DEFAULT 'pending' NOT NULL,
	`storage_path_root` varchar(255) DEFAULT '/srv/fleet-storage',
	`capacity_gb` int,
	`used_gb` int DEFAULT 0,
	`last_health_check` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now())
);
--> statement-breakpoint
CREATE INDEX `storage_nodes_cluster_idx` ON `storage_nodes` (`cluster_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `storage_volumes` (
	`id` varchar(36) PRIMARY KEY NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`display_name` varchar(255),
	`size_gb` int NOT NULL,
	`used_gb` int DEFAULT 0,
	`provider` varchar(50) DEFAULT 'local' NOT NULL,
	`provider_volume_id` varchar(255),
	`mount_path` varchar(255),
	`replica_count` int DEFAULT 1,
	`status` varchar(20) DEFAULT 'creating' NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	`deleted_at` timestamp
);
--> statement-breakpoint
CREATE INDEX `storage_volumes_account_idx` ON `storage_volumes` (`account_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `storage_migrations` (
	`id` varchar(36) PRIMARY KEY NOT NULL,
	`from_provider` varchar(50) NOT NULL,
	`to_provider` varchar(50) NOT NULL,
	`status` varchar(20) DEFAULT 'pending' NOT NULL,
	`progress` int DEFAULT 0,
	`total_bytes` bigint,
	`migrated_bytes` bigint DEFAULT 0,
	`current_item` varchar(255),
	`log` text,
	`started_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp DEFAULT (now())
);
