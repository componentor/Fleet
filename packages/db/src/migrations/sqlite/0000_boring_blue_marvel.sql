CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`slug` text,
	`parent_id` text,
	`path` text,
	`depth` integer DEFAULT 0,
	`trust_revocable` integer DEFAULT false,
	`stripe_customer_id` text,
	`stripe_connect_account_id` text,
	`plan` text,
	`status` text DEFAULT 'active',
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `accounts_slug_unique` ON `accounts` (`slug`);--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`created_by` text NOT NULL,
	`name` text NOT NULL,
	`key_prefix` text NOT NULL,
	`key_hash` text NOT NULL,
	`scopes` text,
	`last_used_at` integer,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`account_id` text,
	`action` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`ip_address` text,
	`details` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `backup_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`service_id` text,
	`cron` text NOT NULL,
	`retention_days` integer DEFAULT 30,
	`retention_count` integer DEFAULT 10,
	`storage_backend` text DEFAULT 'nfs',
	`enabled` integer DEFAULT true,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	`last_run_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `backups` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`service_id` text,
	`type` text DEFAULT 'manual',
	`status` text DEFAULT 'pending',
	`storage_path` text,
	`storage_backend` text DEFAULT 'nfs',
	`size_bytes` integer DEFAULT 0,
	`contents` text,
	`created_at` integer DEFAULT (unixepoch()),
	`expires_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `account_billing_overrides` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`discount_percent` integer DEFAULT 0,
	`custom_price_cents` integer,
	`notes` text,
	`cpu_cents_per_hour_override` integer,
	`memory_cents_per_gb_hour_override` integer,
	`storage_cents_per_gb_month_override` integer,
	`bandwidth_cents_per_gb_override` integer,
	`container_cents_per_hour_override` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_billing_overrides_account_id_unique` ON `account_billing_overrides` (`account_id`);--> statement-breakpoint
CREATE TABLE `billing_config` (
	`id` text PRIMARY KEY NOT NULL,
	`billing_model` text DEFAULT 'fixed' NOT NULL,
	`allow_user_choice` integer DEFAULT false,
	`allowed_cycles` text,
	`cycle_discounts` text,
	`trial_days` integer DEFAULT 0,
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `billing_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text,
	`sort_order` integer DEFAULT 0,
	`is_default` integer DEFAULT false,
	`is_free` integer DEFAULT false,
	`visible` integer DEFAULT true,
	`cpu_limit` integer NOT NULL,
	`memory_limit` integer NOT NULL,
	`container_limit` integer NOT NULL,
	`storage_limit` integer NOT NULL,
	`bandwidth_limit` integer,
	`price_cents` integer NOT NULL,
	`stripe_product_id` text,
	`stripe_price_ids` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `billing_plans_slug_unique` ON `billing_plans` (`slug`);--> statement-breakpoint
CREATE TABLE `location_multipliers` (
	`id` text PRIMARY KEY NOT NULL,
	`location_key` text NOT NULL,
	`label` text NOT NULL,
	`multiplier` integer DEFAULT 100,
	`created_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `location_multipliers_location_key_unique` ON `location_multipliers` (`location_key`);--> statement-breakpoint
CREATE TABLE `pricing_config` (
	`id` text PRIMARY KEY NOT NULL,
	`cpu_cents_per_hour` integer DEFAULT 0,
	`memory_cents_per_gb_hour` integer DEFAULT 0,
	`storage_cents_per_gb_month` integer DEFAULT 0,
	`bandwidth_cents_per_gb` integer DEFAULT 0,
	`container_cents_per_hour` integer DEFAULT 0,
	`domain_markup_percent` integer DEFAULT 0,
	`backup_storage_cents_per_gb` integer DEFAULT 0,
	`location_pricing_enabled` integer DEFAULT false,
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `resource_limits` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text,
	`max_cpu_per_container` integer,
	`max_memory_per_container` integer,
	`max_replicas` integer,
	`max_containers` integer,
	`max_storage_gb` integer,
	`max_bandwidth_gb` integer,
	`max_nfs_storage_gb` integer,
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`plan_id` text,
	`billing_model` text DEFAULT 'fixed',
	`stripe_subscription_id` text,
	`stripe_customer_id` text,
	`billing_cycle` text DEFAULT 'monthly',
	`status` text DEFAULT 'active',
	`trial_ends_at` integer,
	`current_period_start` integer,
	`current_period_end` integer,
	`cancelled_at` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `billing_plans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`period_start` integer,
	`period_end` integer,
	`containers` integer DEFAULT 0,
	`cpu_seconds` integer DEFAULT 0,
	`memory_mb_hours` integer DEFAULT 0,
	`storage_gb` integer DEFAULT 0,
	`bandwidth_gb` integer DEFAULT 0,
	`recorded_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `dns_records` (
	`id` text PRIMARY KEY NOT NULL,
	`zone_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`ttl` integer DEFAULT 3600,
	`priority` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`zone_id`) REFERENCES `dns_zones`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `dns_zones` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`domain` text NOT NULL,
	`verified` integer DEFAULT false,
	`nameservers` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `domain_registrars` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`api_key` text NOT NULL,
	`api_secret` text,
	`config` text,
	`enabled` integer DEFAULT true,
	`created_by` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `domain_registrations` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`registrar_id` text NOT NULL,
	`domain` text NOT NULL,
	`status` text DEFAULT 'pending',
	`registered_at` integer,
	`expires_at` integer,
	`auto_renew` integer DEFAULT true,
	`registrar_domain_id` text,
	`stripe_payment_id` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`registrar_id`) REFERENCES `domain_registrars`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `domain_tld_pricing` (
	`id` text PRIMARY KEY NOT NULL,
	`tld` text NOT NULL,
	`provider_registration_price` integer NOT NULL,
	`provider_renewal_price` integer NOT NULL,
	`markup_type` text DEFAULT 'percentage' NOT NULL,
	`markup_value` integer DEFAULT 20 NOT NULL,
	`sell_registration_price` integer NOT NULL,
	`sell_renewal_price` integer NOT NULL,
	`enabled` integer DEFAULT true,
	`currency` text DEFAULT 'USD' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `domain_tld_pricing_tld_unique` ON `domain_tld_pricing` (`tld`);--> statement-breakpoint
CREATE TABLE `email_log` (
	`id` text PRIMARY KEY NOT NULL,
	`template_slug` text NOT NULL,
	`to_email` text NOT NULL,
	`subject` text NOT NULL,
	`account_id` text,
	`status` text DEFAULT 'queued',
	`sent_at` integer,
	`error` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`subject` text NOT NULL,
	`body_html` text NOT NULL,
	`variables` text,
	`account_id` text,
	`enabled` integer DEFAULT true,
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_templates_slug_unique` ON `email_templates` (`slug`);--> statement-breakpoint
CREATE TABLE `oauth_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_user_id` text NOT NULL,
	`access_token` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `oauth_provider_user_idx` ON `oauth_providers` (`provider`,`provider_user_id`);--> statement-breakpoint
CREATE TABLE `user_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`account_id` text NOT NULL,
	`role` text DEFAULT 'member',
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_accounts_user_account_idx` ON `user_accounts` (`user_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text,
	`password_hash` text,
	`name` text,
	`avatar_url` text,
	`is_super` integer DEFAULT false,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`commit_sha` text,
	`status` text DEFAULT 'pending',
	`log` text DEFAULT '',
	`image_tag` text,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`name` text NOT NULL,
	`image` text NOT NULL,
	`replicas` integer DEFAULT 1,
	`env` text,
	`ports` text,
	`volumes` text,
	`docker_service_id` text,
	`github_repo` text,
	`github_branch` text,
	`auto_deploy` integer DEFAULT false,
	`domain` text,
	`ssl_enabled` integer DEFAULT true,
	`status` text DEFAULT 'stopped',
	`node_constraint` text,
	`placement_constraints` text,
	`update_parallelism` integer DEFAULT 1,
	`update_delay` text DEFAULT '10s',
	`rollback_on_failure` integer DEFAULT true,
	`health_check` text,
	`cpu_limit` integer,
	`memory_limit` integer,
	`cpu_reservation` integer,
	`memory_reservation` integer,
	`stopped_at` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`hostname` text NOT NULL,
	`ip_address` text NOT NULL,
	`docker_node_id` text,
	`role` text DEFAULT 'worker',
	`status` text DEFAULT 'active',
	`labels` text,
	`location` text,
	`nfs_server` integer DEFAULT false,
	`last_heartbeat` integer,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE TABLE `ssh_access_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`service_id` text NOT NULL,
	`allowed_ips` text,
	`enabled` integer DEFAULT true,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `ssh_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`public_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `app_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`slug` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '',
	`icon_url` text,
	`category` text DEFAULT 'other',
	`compose_template` text NOT NULL,
	`variables` text,
	`is_builtin` integer DEFAULT false,
	`account_id` text,
	`created_at` integer DEFAULT (unixepoch()),
	`updated_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `app_templates_slug_unique` ON `app_templates` (`slug`);--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX `platform_settings_key_unique` ON `platform_settings` (`key`);--> statement-breakpoint
CREATE TABLE `node_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`node_id` text NOT NULL,
	`hostname` text NOT NULL,
	`cpu_count` integer NOT NULL,
	`mem_total` integer NOT NULL,
	`mem_used` integer NOT NULL,
	`mem_free` integer NOT NULL,
	`container_count` integer NOT NULL,
	`recorded_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`user_id` text,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`resource_type` text,
	`resource_id` text,
	`read` integer DEFAULT false,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
