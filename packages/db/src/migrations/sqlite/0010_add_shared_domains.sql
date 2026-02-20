CREATE TABLE IF NOT EXISTS `shared_domains` (
  `id` text PRIMARY KEY NOT NULL,
  `domain` text NOT NULL,
  `enabled` integer DEFAULT 1,
  `pricing_type` text NOT NULL DEFAULT 'free',
  `price` integer NOT NULL DEFAULT 0,
  `currency` text NOT NULL DEFAULT 'USD',
  `max_per_account` integer NOT NULL DEFAULT 0,
  `created_by` text REFERENCES `users`(`id`) ON DELETE SET NULL,
  `created_at` integer DEFAULT (unixepoch()),
  `updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `shared_domains_domain_unique` ON `shared_domains` (`domain`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `subdomain_claims` (
  `id` text PRIMARY KEY NOT NULL,
  `shared_domain_id` text NOT NULL REFERENCES `shared_domains`(`id`) ON DELETE CASCADE,
  `account_id` text NOT NULL REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  `subdomain` text NOT NULL,
  `service_id` text REFERENCES `services`(`id`) ON DELETE SET NULL,
  `status` text NOT NULL DEFAULT 'active',
  `stripe_payment_id` text,
  `stripe_subscription_id` text,
  `created_at` integer DEFAULT (unixepoch()),
  `updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `subdomain_claims_unique` ON `subdomain_claims` (`shared_domain_id`, `subdomain`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_subdomain_claims_shared_domain_id` ON `subdomain_claims` (`shared_domain_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_subdomain_claims_account_id` ON `subdomain_claims` (`account_id`);
