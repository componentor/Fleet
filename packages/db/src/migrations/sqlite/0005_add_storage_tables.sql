ALTER TABLE `resource_limits` ADD COLUMN `max_container_disk_mb` integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `storage_clusters` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text DEFAULT 'local' NOT NULL,
	`object_provider` text DEFAULT 'local' NOT NULL,
	`status` text DEFAULT 'inactive' NOT NULL,
	`replication_factor` integer DEFAULT 3,
	`config` text DEFAULT '{}',
	`object_config` text DEFAULT '{}',
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `storage_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`cluster_id` text REFERENCES `storage_clusters`(`id`),
	`node_id` text REFERENCES `nodes`(`id`),
	`hostname` text NOT NULL,
	`ip_address` text NOT NULL,
	`role` text DEFAULT 'storage' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`storage_path_root` text DEFAULT '/srv/fleet-storage',
	`capacity_gb` integer,
	`used_gb` integer DEFAULT 0,
	`last_health_check` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `storage_nodes_cluster_idx` ON `storage_nodes` (`cluster_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `storage_volumes` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL REFERENCES `accounts`(`id`),
	`name` text NOT NULL,
	`display_name` text,
	`size_gb` integer NOT NULL,
	`used_gb` integer DEFAULT 0,
	`provider` text DEFAULT 'local' NOT NULL,
	`provider_volume_id` text,
	`mount_path` text,
	`replica_count` integer DEFAULT 1,
	`status` text DEFAULT 'creating' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `storage_volumes_account_idx` ON `storage_volumes` (`account_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `storage_migrations` (
	`id` text PRIMARY KEY NOT NULL,
	`from_provider` text NOT NULL,
	`to_provider` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`progress` integer DEFAULT 0,
	`total_bytes` integer,
	`migrated_bytes` integer DEFAULT 0,
	`current_item` text,
	`log` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch())
);
