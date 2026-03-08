ALTER TABLE `services` ADD COLUMN `source_type` varchar(20);
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `source_path` varchar(500);
