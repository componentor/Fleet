CREATE TABLE IF NOT EXISTS `registry_credentials` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`registry` varchar(255) NOT NULL,
	`username` varchar(255) NOT NULL,
	`password` text NOT NULL,
	`created_at` timestamp DEFAULT now(),
	`updated_at` timestamp DEFAULT now(),
	CONSTRAINT `registry_credentials_id` PRIMARY KEY(`id`),
	CONSTRAINT `registry_credentials_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_registry_credentials_account_id` ON `registry_credentials` (`account_id`);
