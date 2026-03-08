CREATE TABLE IF NOT EXISTS `shared_domains` (
  `id` varchar(36) NOT NULL,
  `domain` varchar(255) NOT NULL,
  `enabled` boolean DEFAULT true,
  `pricing_type` varchar(20) NOT NULL DEFAULT 'free',
  `price` int NOT NULL DEFAULT 0,
  `currency` varchar(3) NOT NULL DEFAULT 'USD',
  `max_per_account` int NOT NULL DEFAULT 0,
  `created_by` varchar(36),
  `created_at` timestamp DEFAULT (now()),
  `updated_at` timestamp DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `shared_domains_domain_unique` (`domain`),
  CONSTRAINT `shared_domains_created_by_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `subdomain_claims` (
  `id` varchar(36) NOT NULL,
  `shared_domain_id` varchar(36) NOT NULL,
  `account_id` varchar(36) NOT NULL,
  `subdomain` varchar(63) NOT NULL,
  `service_id` varchar(36),
  `status` varchar(20) NOT NULL DEFAULT 'active',
  `stripe_payment_id` varchar(255),
  `stripe_subscription_id` varchar(255),
  `created_at` timestamp DEFAULT (now()),
  `updated_at` timestamp DEFAULT (now()),
  PRIMARY KEY (`id`),
  UNIQUE KEY `subdomain_claims_unique` (`shared_domain_id`, `subdomain`),
  CONSTRAINT `subdomain_claims_shared_domain_fk` FOREIGN KEY (`shared_domain_id`) REFERENCES `shared_domains`(`id`) ON DELETE CASCADE,
  CONSTRAINT `subdomain_claims_account_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  CONSTRAINT `subdomain_claims_service_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX `idx_subdomain_claims_shared_domain_id` ON `subdomain_claims` (`shared_domain_id`);
--> statement-breakpoint
CREATE INDEX `idx_subdomain_claims_account_id` ON `subdomain_claims` (`account_id`);
