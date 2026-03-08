ALTER TABLE `account_billing_overrides` ADD COLUMN `boost_cpu_limit` int;
--> statement-breakpoint
ALTER TABLE `account_billing_overrides` ADD COLUMN `boost_memory_limit` int;
--> statement-breakpoint
ALTER TABLE `account_billing_overrides` ADD COLUMN `boost_container_limit` int;
--> statement-breakpoint
ALTER TABLE `account_billing_overrides` ADD COLUMN `boost_storage_limit` int;
