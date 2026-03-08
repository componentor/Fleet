CREATE TABLE IF NOT EXISTS `reseller_config` (
  `id` varchar(36) PRIMARY KEY,
  `enabled` boolean DEFAULT false,
  `approval_mode` varchar(255) DEFAULT 'manual',
  `allow_sub_account_reselling` boolean DEFAULT false,
  `default_discount_type` varchar(255) DEFAULT 'percentage',
  `default_discount_percent` int DEFAULT 0,
  `default_discount_fixed` int DEFAULT 0,
  `updated_at` timestamp DEFAULT (now())
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reseller_accounts` (
  `id` varchar(36) PRIMARY KEY,
  `account_id` varchar(36) NOT NULL,
  `status` varchar(255) DEFAULT 'pending',
  `stripe_connect_id` varchar(255),
  `connect_onboarded` boolean DEFAULT false,
  `discount_type` varchar(255),
  `discount_percent` int,
  `discount_fixed` int,
  `markup_type` varchar(255) DEFAULT 'percentage',
  `markup_percent` int DEFAULT 0,
  `markup_fixed` int DEFAULT 0,
  `can_sub_account_resell` boolean DEFAULT false,
  `signup_slug` varchar(255) UNIQUE,
  `custom_domain` varchar(255),
  `brand_name` varchar(255),
  `brand_logo_url` varchar(1024),
  `brand_primary_color` varchar(20),
  `brand_description` text,
  `approved_at` timestamp,
  `approved_by` varchar(36),
  `created_at` timestamp DEFAULT (now()),
  `updated_at` timestamp DEFAULT (now()),
  CONSTRAINT `reseller_accounts_account_id_unique` UNIQUE(`account_id`),
  CONSTRAINT `reseller_accounts_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reseller_applications` (
  `id` varchar(36) PRIMARY KEY,
  `account_id` varchar(36) NOT NULL,
  `message` text,
  `status` varchar(255) DEFAULT 'pending',
  `reviewed_by` varchar(36),
  `reviewed_at` timestamp,
  `review_note` text,
  `created_at` timestamp DEFAULT (now()),
  CONSTRAINT `reseller_applications_account_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE INDEX `idx_reseller_accounts_status` ON `reseller_accounts` (`status`);--> statement-breakpoint
CREATE INDEX `idx_reseller_applications_account_id` ON `reseller_applications` (`account_id`);--> statement-breakpoint
CREATE INDEX `idx_reseller_applications_status` ON `reseller_applications` (`status`);
