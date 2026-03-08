ALTER TABLE `billing_plan_prices` ADD COLUMN `cycle` varchar(20) NOT NULL DEFAULT 'monthly';
--> statement-breakpoint
ALTER TABLE `billing_plan_prices` DROP INDEX `idx_billing_plan_prices_plan_currency`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_billing_plan_prices_plan_currency_cycle` ON `billing_plan_prices` (`plan_id`, `currency`, `cycle`);
