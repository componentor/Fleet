ALTER TABLE `node_metrics` ADD COLUMN `disk_total` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `node_metrics` ADD COLUMN `disk_used` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `node_metrics` ADD COLUMN `disk_free` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `node_metrics` ADD COLUMN `disk_type` text NOT NULL DEFAULT 'unknown';
