-- Create stacks table
CREATE TABLE IF NOT EXISTS `stacks` (
  `id` varchar(36) PRIMARY KEY,
  `account_id` varchar(36) NOT NULL,
  `name` varchar(255),
  `template_slug` varchar(255),
  `status` varchar(255) DEFAULT 'active',
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
CREATE INDEX `idx_stacks_account_id` ON `stacks` (`account_id`);
CREATE INDEX `idx_stacks_deleted_at` ON `stacks` (`deleted_at`);

-- Billing plans: add scope and volume_included_gb columns
ALTER TABLE `billing_plans` ADD COLUMN `scope` varchar(255) DEFAULT 'service';
ALTER TABLE `billing_plans` ADD COLUMN `volume_included_gb` int DEFAULT 0;

-- Subscriptions: add service/stack/payment contact columns
ALTER TABLE `subscriptions` ADD COLUMN `service_id` varchar(36),
  ADD COLUMN `stack_id` varchar(36),
  ADD COLUMN `payment_contact_name` varchar(255),
  ADD COLUMN `payment_contact_email` varchar(255);
ALTER TABLE `subscriptions` ADD CONSTRAINT `fk_subscriptions_stack_id` FOREIGN KEY (`stack_id`) REFERENCES `stacks`(`id`) ON DELETE SET NULL;
CREATE INDEX `idx_subscriptions_service_id` ON `subscriptions` (`service_id`);
CREATE INDEX `idx_subscriptions_stack_id` ON `subscriptions` (`stack_id`);

-- Usage records: add service/stack columns
ALTER TABLE `usage_records` ADD COLUMN `service_id` varchar(36),
  ADD COLUMN `stack_id` varchar(36);
CREATE INDEX `idx_usage_records_service_id` ON `usage_records` (`service_id`);
CREATE INDEX `idx_usage_records_stack_id` ON `usage_records` (`stack_id`);

-- Storage volumes: add service/stack/unbound columns
ALTER TABLE `storage_volumes` ADD COLUMN `service_id` varchar(36),
  ADD COLUMN `stack_id` varchar(36),
  ADD COLUMN `is_unbound` boolean DEFAULT false;
CREATE INDEX `idx_storage_volumes_service_id` ON `storage_volumes` (`service_id`);
CREATE INDEX `idx_storage_volumes_stack_id` ON `storage_volumes` (`stack_id`);

-- Services: add plan_id
ALTER TABLE `services` ADD COLUMN `plan_id` varchar(36);
ALTER TABLE `services` ADD CONSTRAINT `fk_services_plan_id` FOREIGN KEY (`plan_id`) REFERENCES `billing_plans`(`id`) ON DELETE SET NULL;
CREATE INDEX `idx_services_plan_id` ON `services` (`plan_id`);
