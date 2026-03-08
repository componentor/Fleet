ALTER TABLE `services` ADD COLUMN `restart_condition` varchar(20) DEFAULT 'on-failure';
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `restart_max_attempts` int DEFAULT 3;
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `restart_delay` varchar(20) DEFAULT '10s';
