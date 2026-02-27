CREATE TABLE IF NOT EXISTS `support_tickets` (
	`id` varchar(36) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'open',
	`priority` varchar(50) NOT NULL DEFAULT 'normal',
	`account_id` varchar(36) NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`assigned_to` varchar(36),
	`closed_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `support_tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_support_tickets_account_id` ON `support_tickets` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_support_tickets_status` ON `support_tickets` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_support_tickets_assigned_to` ON `support_tickets` (`assigned_to`);
--> statement-breakpoint
CREATE INDEX `idx_support_tickets_created_by` ON `support_tickets` (`created_by`);
--> statement-breakpoint
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_assigned_to_users_id_fk` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `support_ticket_messages` (
	`id` varchar(36) NOT NULL,
	`ticket_id` varchar(36) NOT NULL,
	`author_id` varchar(36) NOT NULL,
	`body` text NOT NULL,
	`is_internal` boolean DEFAULT false,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `support_ticket_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_support_ticket_messages_ticket_id` ON `support_ticket_messages` (`ticket_id`);
--> statement-breakpoint
ALTER TABLE `support_ticket_messages` ADD CONSTRAINT `support_ticket_messages_ticket_id_support_tickets_id_fk` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE `support_ticket_messages` ADD CONSTRAINT `support_ticket_messages_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE CASCADE;
