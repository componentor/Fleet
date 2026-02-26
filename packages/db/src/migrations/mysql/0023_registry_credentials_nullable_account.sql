ALTER TABLE `registry_credentials` DROP INDEX `idx_registry_credentials_account_id`;
ALTER TABLE `registry_credentials` DROP FOREIGN KEY `registry_credentials_account_id_accounts_id_fk`;
ALTER TABLE `registry_credentials` DROP COLUMN `account_id`;
