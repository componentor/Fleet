-- Re-add account_id to registry_credentials
ALTER TABLE `registry_credentials` ADD COLUMN `account_id` varchar(36);
ALTER TABLE `registry_credentials` ADD CONSTRAINT `registry_credentials_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE;
CREATE INDEX `idx_registry_credentials_account_id` ON `registry_credentials` (`account_id`);

-- Add registry polling columns to services
ALTER TABLE `services` ADD COLUMN `registry_poll_enabled` boolean DEFAULT false;
ALTER TABLE `services` ADD COLUMN `registry_poll_interval` int DEFAULT 300;
ALTER TABLE `services` ADD COLUMN `registry_poll_digest` varchar(255);
ALTER TABLE `services` ADD COLUMN `registry_webhook_secret` varchar(255);
