ALTER TABLE `reseller_accounts` ADD COLUMN `custom_domain_verified` boolean DEFAULT false;
ALTER TABLE `reseller_accounts` ADD COLUMN `custom_domain_token` varchar(255);
