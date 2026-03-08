CREATE TABLE IF NOT EXISTS `billing_plan_prices` (
  `id` varchar(36) PRIMARY KEY,
  `plan_id` varchar(36) NOT NULL,
  `currency` varchar(3) NOT NULL,
  `price_cents` int NOT NULL,
  `created_at` timestamp DEFAULT (now()),
  `updated_at` timestamp DEFAULT (now()),
  CONSTRAINT `fk_bpp_plan` FOREIGN KEY (`plan_id`) REFERENCES `billing_plans`(`id`) ON DELETE CASCADE,
  UNIQUE INDEX `idx_billing_plan_prices_plan_currency` (`plan_id`, `currency`)
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `domain_tld_currency_prices` (
  `id` varchar(36) PRIMARY KEY,
  `tld_pricing_id` varchar(36) NOT NULL,
  `currency` varchar(3) NOT NULL,
  `sell_registration_price` int NOT NULL,
  `sell_renewal_price` int NOT NULL,
  `created_at` timestamp DEFAULT (now()),
  `updated_at` timestamp DEFAULT (now()),
  CONSTRAINT `fk_dtcp_tld` FOREIGN KEY (`tld_pricing_id`) REFERENCES `domain_tld_pricing`(`id`) ON DELETE CASCADE,
  UNIQUE INDEX `idx_tld_currency_prices_tld_currency` (`tld_pricing_id`, `currency`)
);
