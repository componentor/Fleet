CREATE TABLE IF NOT EXISTS `admin_roles` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` varchar(255),
	`permissions` json NOT NULL DEFAULT ('{}'),
	`is_builtin` boolean DEFAULT false,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `admin_roles_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_roles_name_idx` ON `admin_roles` (`name`);
--> statement-breakpoint
ALTER TABLE `users` ADD COLUMN `admin_role_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_admin_role_id_admin_roles_id_fk` FOREIGN KEY (`admin_role_id`) REFERENCES `admin_roles`(`id`) ON DELETE SET NULL;
