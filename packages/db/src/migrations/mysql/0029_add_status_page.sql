CREATE TABLE IF NOT EXISTS `status_posts` (
	`id` varchar(36) NOT NULL,
	`icon` varchar(50) NOT NULL DEFAULT 'info',
	`severity` varchar(50) NOT NULL DEFAULT 'info',
	`status` varchar(50) NOT NULL DEFAULT 'draft',
	`affected_services` json DEFAULT ('[]'),
	`published_at` timestamp,
	`created_by` varchar(36),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `status_posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `status_posts` ADD CONSTRAINT `status_posts_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `idx_status_posts_status` ON `status_posts` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_status_posts_published_at` ON `status_posts` (`published_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `status_post_translations` (
	`id` varchar(36) NOT NULL,
	`post_id` varchar(36) NOT NULL,
	`locale` varchar(10) NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `status_post_translations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `status_post_translations` ADD CONSTRAINT `status_post_translations_post_id_status_posts_id_fk` FOREIGN KEY (`post_id`) REFERENCES `status_posts`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_status_post_translations_post_locale` ON `status_post_translations` (`post_id`, `locale`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `uptime_snapshots` (
	`id` varchar(36) NOT NULL,
	`service` varchar(255) NOT NULL,
	`status` varchar(50) NOT NULL,
	`response_ms` int,
	`recorded_at` timestamp DEFAULT (now()),
	CONSTRAINT `uptime_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_uptime_snapshots_service_recorded` ON `uptime_snapshots` (`service`, `recorded_at`);
