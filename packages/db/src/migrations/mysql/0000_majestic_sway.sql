CREATE TABLE `accounts` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255),
	`slug` varchar(255),
	`parent_id` varchar(36),
	`path` text,
	`depth` int DEFAULT 0,
	`trust_revocable` boolean DEFAULT false,
	`stripe_customer_id` varchar(255),
	`stripe_connect_account_id` varchar(255),
	`plan` json,
	`status` varchar(255) DEFAULT 'active',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `accounts_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `api_keys` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`key_prefix` varchar(16) NOT NULL,
	`key_hash` varchar(255) NOT NULL,
	`scopes` json,
	`last_used_at` timestamp,
	`expires_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36),
	`account_id` varchar(36),
	`action` varchar(255) NOT NULL,
	`resource_type` varchar(255),
	`resource_id` varchar(36),
	`ip_address` varchar(255),
	`details` json,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backup_schedules` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`service_id` varchar(36),
	`cron` varchar(255) NOT NULL,
	`retention_days` int DEFAULT 30,
	`retention_count` int DEFAULT 10,
	`storage_backend` varchar(255) DEFAULT 'nfs',
	`enabled` boolean DEFAULT true,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	`last_run_at` timestamp,
	CONSTRAINT `backup_schedules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backups` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`service_id` varchar(36),
	`type` varchar(255) DEFAULT 'manual',
	`status` varchar(255) DEFAULT 'pending',
	`storage_path` varchar(255),
	`storage_backend` varchar(255) DEFAULT 'nfs',
	`size_bytes` bigint DEFAULT 0,
	`contents` json,
	`created_at` timestamp DEFAULT (now()),
	`expires_at` timestamp,
	CONSTRAINT `backups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `account_billing_overrides` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`discount_percent` int DEFAULT 0,
	`custom_price_cents` int,
	`notes` text,
	`cpu_cents_per_hour_override` int,
	`memory_cents_per_gb_hour_override` int,
	`storage_cents_per_gb_month_override` int,
	`bandwidth_cents_per_gb_override` int,
	`container_cents_per_hour_override` int,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `account_billing_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_billing_overrides_account_id_unique` UNIQUE(`account_id`)
);
--> statement-breakpoint
CREATE TABLE `billing_config` (
	`id` varchar(36) NOT NULL,
	`billing_model` varchar(255) NOT NULL DEFAULT 'fixed',
	`allow_user_choice` boolean DEFAULT false,
	`allowed_cycles` json,
	`cycle_discounts` json,
	`trial_days` int DEFAULT 0,
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `billing_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `billing_plans` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`description` text,
	`sort_order` int DEFAULT 0,
	`is_default` boolean DEFAULT false,
	`is_free` boolean DEFAULT false,
	`visible` boolean DEFAULT true,
	`cpu_limit` int NOT NULL,
	`memory_limit` int NOT NULL,
	`container_limit` int NOT NULL,
	`storage_limit` int NOT NULL,
	`bandwidth_limit` int,
	`price_cents` int NOT NULL,
	`stripe_product_id` varchar(255),
	`stripe_price_ids` json,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `billing_plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `billing_plans_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `location_multipliers` (
	`id` varchar(36) NOT NULL,
	`location_key` varchar(255) NOT NULL,
	`label` varchar(255) NOT NULL,
	`multiplier` int DEFAULT 100,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `location_multipliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `location_multipliers_location_key_unique` UNIQUE(`location_key`)
);
--> statement-breakpoint
CREATE TABLE `pricing_config` (
	`id` varchar(36) NOT NULL,
	`cpu_cents_per_hour` int DEFAULT 0,
	`memory_cents_per_gb_hour` int DEFAULT 0,
	`storage_cents_per_gb_month` int DEFAULT 0,
	`bandwidth_cents_per_gb` int DEFAULT 0,
	`container_cents_per_hour` int DEFAULT 0,
	`domain_markup_percent` int DEFAULT 0,
	`backup_storage_cents_per_gb` int DEFAULT 0,
	`location_pricing_enabled` boolean DEFAULT false,
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `pricing_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `resource_limits` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36),
	`max_cpu_per_container` int,
	`max_memory_per_container` int,
	`max_replicas` int,
	`max_containers` int,
	`max_storage_gb` int,
	`max_bandwidth_gb` int,
	`max_nfs_storage_gb` int,
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `resource_limits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `subscriptions` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`plan_id` varchar(36),
	`billing_model` varchar(255) DEFAULT 'fixed',
	`stripe_subscription_id` varchar(255),
	`stripe_customer_id` varchar(255),
	`billing_cycle` varchar(255) DEFAULT 'monthly',
	`status` varchar(255) DEFAULT 'active',
	`trial_ends_at` timestamp,
	`current_period_start` timestamp,
	`current_period_end` timestamp,
	`cancelled_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`period_start` timestamp,
	`period_end` timestamp,
	`containers` int DEFAULT 0,
	`cpu_seconds` bigint DEFAULT 0,
	`memory_mb_hours` bigint DEFAULT 0,
	`storage_gb` int DEFAULT 0,
	`bandwidth_gb` int DEFAULT 0,
	`recorded_at` timestamp DEFAULT (now()),
	CONSTRAINT `usage_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dns_records` (
	`id` varchar(36) NOT NULL,
	`zone_id` varchar(36) NOT NULL,
	`type` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`content` varchar(255) NOT NULL,
	`ttl` int DEFAULT 3600,
	`priority` int,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `dns_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dns_zones` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`domain` varchar(255) NOT NULL,
	`verified` boolean DEFAULT false,
	`nameservers` json,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `dns_zones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `domain_registrars` (
	`id` varchar(36) NOT NULL,
	`provider` varchar(255) NOT NULL,
	`api_key` varchar(255) NOT NULL,
	`api_secret` varchar(255),
	`config` json,
	`enabled` boolean DEFAULT true,
	`created_by` varchar(36) NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `domain_registrars_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `domain_registrations` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`registrar_id` varchar(36) NOT NULL,
	`domain` varchar(255) NOT NULL,
	`status` varchar(255) DEFAULT 'pending',
	`registered_at` timestamp,
	`expires_at` timestamp,
	`auto_renew` boolean DEFAULT true,
	`registrar_domain_id` varchar(255),
	`stripe_payment_id` varchar(255),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `domain_registrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `domain_tld_pricing` (
	`id` varchar(36) NOT NULL,
	`tld` varchar(63) NOT NULL,
	`provider_registration_price` int NOT NULL,
	`provider_renewal_price` int NOT NULL,
	`markup_type` varchar(20) NOT NULL DEFAULT 'percentage',
	`markup_value` int NOT NULL DEFAULT 20,
	`sell_registration_price` int NOT NULL,
	`sell_renewal_price` int NOT NULL,
	`enabled` boolean DEFAULT true,
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `domain_tld_pricing_id` PRIMARY KEY(`id`),
	CONSTRAINT `domain_tld_pricing_tld_unique` UNIQUE(`tld`)
);
--> statement-breakpoint
CREATE TABLE `email_log` (
	`id` varchar(36) NOT NULL,
	`template_slug` varchar(255) NOT NULL,
	`to_email` varchar(255) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`account_id` varchar(36),
	`status` varchar(255) DEFAULT 'queued',
	`sent_at` timestamp,
	`error` text,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `email_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `email_templates` (
	`id` varchar(36) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`body_html` text NOT NULL,
	`variables` json,
	`account_id` varchar(36),
	`enabled` boolean DEFAULT true,
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `email_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_templates_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `oauth_providers` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`provider` varchar(255) NOT NULL,
	`provider_user_id` varchar(255) NOT NULL,
	`access_token` varchar(255),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `oauth_providers_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_provider_user_idx` UNIQUE(`provider`,`provider_user_id`)
);
--> statement-breakpoint
CREATE TABLE `user_accounts` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`role` varchar(255) DEFAULT 'member',
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `user_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_accounts_user_account_idx` UNIQUE(`user_id`,`account_id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(255),
	`password_hash` varchar(255),
	`name` varchar(255),
	`avatar_url` varchar(255),
	`is_super` boolean DEFAULT false,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` varchar(36) NOT NULL,
	`service_id` varchar(36) NOT NULL,
	`commit_sha` varchar(255),
	`status` varchar(255) DEFAULT 'pending',
	`log` text,
	`image_tag` varchar(255),
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `deployments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`image` varchar(255) NOT NULL,
	`replicas` int DEFAULT 1,
	`env` json,
	`ports` json,
	`volumes` json,
	`docker_service_id` varchar(255),
	`github_repo` varchar(255),
	`github_branch` varchar(255),
	`auto_deploy` boolean DEFAULT false,
	`domain` varchar(255),
	`ssl_enabled` boolean DEFAULT true,
	`status` varchar(255) DEFAULT 'stopped',
	`node_constraint` varchar(255),
	`placement_constraints` json,
	`update_parallelism` int DEFAULT 1,
	`update_delay` varchar(255) DEFAULT '10s',
	`rollback_on_failure` boolean DEFAULT true,
	`health_check` json,
	`cpu_limit` int,
	`memory_limit` int,
	`cpu_reservation` int,
	`memory_reservation` int,
	`stopped_at` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `nodes` (
	`id` varchar(36) NOT NULL,
	`hostname` varchar(255) NOT NULL,
	`ip_address` varchar(255) NOT NULL,
	`docker_node_id` varchar(255),
	`role` varchar(255) DEFAULT 'worker',
	`status` varchar(255) DEFAULT 'active',
	`labels` json,
	`location` varchar(255),
	`nfs_server` boolean DEFAULT false,
	`last_heartbeat` timestamp,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `nodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ssh_access_rules` (
	`id` varchar(36) NOT NULL,
	`service_id` varchar(36) NOT NULL,
	`allowed_ips` json,
	`enabled` boolean DEFAULT true,
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `ssh_access_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ssh_keys` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`public_key` text NOT NULL,
	`fingerprint` varchar(255) NOT NULL,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `ssh_keys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `app_templates` (
	`id` varchar(36) NOT NULL,
	`slug` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` text,
	`icon_url` varchar(255),
	`category` varchar(255) DEFAULT 'other',
	`compose_template` text NOT NULL,
	`variables` json,
	`is_builtin` boolean DEFAULT false,
	`account_id` varchar(36),
	`created_at` timestamp DEFAULT (now()),
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `app_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_templates_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`id` varchar(36) NOT NULL,
	`key` varchar(255) NOT NULL,
	`value` json NOT NULL,
	`updated_at` timestamp DEFAULT (now()),
	CONSTRAINT `platform_settings_id` PRIMARY KEY(`id`),
	CONSTRAINT `platform_settings_key_unique` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `node_metrics` (
	`id` varchar(36) NOT NULL,
	`node_id` varchar(36) NOT NULL,
	`hostname` varchar(255) NOT NULL,
	`cpu_count` int NOT NULL,
	`mem_total` bigint NOT NULL,
	`mem_used` bigint NOT NULL,
	`mem_free` bigint NOT NULL,
	`container_count` int NOT NULL,
	`recorded_at` timestamp DEFAULT (now()),
	CONSTRAINT `node_metrics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`user_id` varchar(36),
	`type` varchar(255) NOT NULL,
	`title` varchar(255) NOT NULL,
	`message` varchar(2000) NOT NULL,
	`resource_type` varchar(255),
	`resource_id` varchar(36),
	`read` boolean DEFAULT false,
	`created_at` timestamp DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backup_schedules` ADD CONSTRAINT `backup_schedules_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backup_schedules` ADD CONSTRAINT `backup_schedules_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backups` ADD CONSTRAINT `backups_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `backups` ADD CONSTRAINT `backups_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `account_billing_overrides` ADD CONSTRAINT `account_billing_overrides_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `resource_limits` ADD CONSTRAINT `resource_limits_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_plan_id_billing_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `billing_plans`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `usage_records` ADD CONSTRAINT `usage_records_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dns_records` ADD CONSTRAINT `dns_records_zone_id_dns_zones_id_fk` FOREIGN KEY (`zone_id`) REFERENCES `dns_zones`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `dns_zones` ADD CONSTRAINT `dns_zones_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `domain_registrars` ADD CONSTRAINT `domain_registrars_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `domain_registrations` ADD CONSTRAINT `domain_registrations_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `domain_registrations` ADD CONSTRAINT `domain_registrations_registrar_id_domain_registrars_id_fk` FOREIGN KEY (`registrar_id`) REFERENCES `domain_registrars`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_log` ADD CONSTRAINT `email_log_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `email_templates` ADD CONSTRAINT `email_templates_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `oauth_providers` ADD CONSTRAINT `oauth_providers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_accounts` ADD CONSTRAINT `user_accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_accounts` ADD CONSTRAINT `user_accounts_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `deployments` ADD CONSTRAINT `deployments_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `services` ADD CONSTRAINT `services_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ssh_access_rules` ADD CONSTRAINT `ssh_access_rules_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ssh_keys` ADD CONSTRAINT `ssh_keys_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `app_templates` ADD CONSTRAINT `app_templates_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `node_metrics` ADD CONSTRAINT `node_metrics_node_id_nodes_id_fk` FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;