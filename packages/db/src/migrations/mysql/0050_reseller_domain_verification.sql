ALTER TABLE `reseller_accounts` ADD COLUMN `custom_domain_verified` boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE `reseller_accounts` ADD COLUMN `custom_domain_token` varchar(255);
