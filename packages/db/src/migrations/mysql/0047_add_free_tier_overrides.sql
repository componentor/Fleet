ALTER TABLE `account_billing_overrides` ADD COLUMN `max_free_services` int;
--> statement-breakpoint
ALTER TABLE `account_billing_overrides` ADD COLUMN `free_tier_cpu_limit` int;
--> statement-breakpoint
ALTER TABLE `account_billing_overrides` ADD COLUMN `free_tier_memory_limit` int;
--> statement-breakpoint
ALTER TABLE `account_billing_overrides` ADD COLUMN `free_tier_container_limit` int;
--> statement-breakpoint
ALTER TABLE `account_billing_overrides` ADD COLUMN `free_tier_storage_limit` int;
