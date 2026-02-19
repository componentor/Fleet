ALTER TABLE `services` ADD COLUMN `restart_condition` text DEFAULT 'on-failure';
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `restart_max_attempts` integer DEFAULT 3;
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `restart_delay` text DEFAULT '10s';
