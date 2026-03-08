ALTER TABLE `billing_plans` ADD COLUMN `name_translations` json DEFAULT ('{}');
ALTER TABLE `billing_plans` ADD COLUMN `description_translations` json DEFAULT ('{}');
