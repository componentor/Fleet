ALTER TABLE `subscriptions` ADD COLUMN `billed_by_account_id` varchar(36);
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_billed_by_account_id_accounts_id_fk` FOREIGN KEY (`billed_by_account_id`) REFERENCES `accounts`(`id`) ON DELETE SET NULL;
