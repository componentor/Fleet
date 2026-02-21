CREATE TABLE IF NOT EXISTS `reseller_config` (
  `id` text PRIMARY KEY,
  `enabled` integer DEFAULT 0,
  `approval_mode` text DEFAULT 'manual',
  `allow_sub_account_reselling` integer DEFAULT 0,
  `default_discount_type` text DEFAULT 'percentage',
  `default_discount_percent` integer DEFAULT 0,
  `default_discount_fixed` integer DEFAULT 0,
  `updated_at` integer DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS `reseller_accounts` (
  `id` text PRIMARY KEY,
  `account_id` text NOT NULL REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  `status` text DEFAULT 'pending',
  `stripe_connect_id` text,
  `connect_onboarded` integer DEFAULT 0,
  `discount_type` text,
  `discount_percent` integer,
  `discount_fixed` integer,
  `markup_type` text DEFAULT 'percentage',
  `markup_percent` integer DEFAULT 0,
  `markup_fixed` integer DEFAULT 0,
  `can_sub_account_resell` integer DEFAULT 0,
  `signup_slug` text UNIQUE,
  `custom_domain` text,
  `brand_name` text,
  `brand_logo_url` text,
  `brand_primary_color` text,
  `brand_description` text,
  `approved_at` integer,
  `approved_by` text,
  `created_at` integer DEFAULT (unixepoch()),
  `updated_at` integer DEFAULT (unixepoch()),
  CONSTRAINT `reseller_accounts_account_id_unique` UNIQUE(`account_id`)
);

CREATE TABLE IF NOT EXISTS `reseller_applications` (
  `id` text PRIMARY KEY,
  `account_id` text NOT NULL REFERENCES `accounts`(`id`) ON DELETE CASCADE,
  `message` text,
  `status` text DEFAULT 'pending',
  `reviewed_by` text,
  `reviewed_at` integer,
  `review_note` text,
  `created_at` integer DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS `idx_reseller_accounts_status` ON `reseller_accounts` (`status`);
CREATE INDEX IF NOT EXISTS `idx_reseller_applications_account_id` ON `reseller_applications` (`account_id`);
CREATE INDEX IF NOT EXISTS `idx_reseller_applications_status` ON `reseller_applications` (`status`);
