CREATE TABLE IF NOT EXISTS `self_healing_jobs` (
	`id` varchar(36) NOT NULL,
	`prompt` text NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'pending',
	`base_branch` varchar(255),
	`working_branch` varchar(255),
	`pr_url` varchar(500),
	`pr_number` int,
	`commit_sha` varchar(255),
	`release_tag` varchar(100),
	`ci_status` varchar(50),
	`docker_service_id` varchar(255),
	`container_id` varchar(255),
	`log` text,
	`options` json NOT NULL DEFAULT ('{}'),
	`error` text,
	`created_by` varchar(36),
	`started_at` timestamp,
	`completed_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `self_healing_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_self_healing_jobs_status` ON `self_healing_jobs` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_self_healing_jobs_created_by` ON `self_healing_jobs` (`created_by`);
--> statement-breakpoint
CREATE INDEX `idx_self_healing_jobs_created_at` ON `self_healing_jobs` (`created_at`);
--> statement-breakpoint
ALTER TABLE `self_healing_jobs` ADD CONSTRAINT `self_healing_jobs_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL;
