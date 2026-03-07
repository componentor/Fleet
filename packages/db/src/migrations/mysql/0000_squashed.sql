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
	`currency` varchar(3) DEFAULT 'USD',
	`plan` json,
	`status` varchar(255) DEFAULT 'active',
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	`suspended_at` datetime,
	`scheduled_deletion_at` datetime,
	`deleted_at` datetime,
	CONSTRAINT `accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `accounts_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `admin_roles` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`description` varchar(255),
	`permissions` json NOT NULL DEFAULT ('{}'),
	`is_builtin` boolean DEFAULT false,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `admin_roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `admin_roles_name_idx` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` varchar(36) NOT NULL,
	`email` varchar(255),
	`password_hash` varchar(255),
	`name` varchar(255),
	`avatar_url` varchar(255),
	`is_super` boolean DEFAULT false,
	`admin_role_id` varchar(36),
	`email_verified` boolean DEFAULT false,
	`email_verify_token` varchar(255),
	`email_verify_expires` datetime,
	`password_reset_token` varchar(255),
	`password_reset_expires` datetime,
	`two_factor_enabled` boolean DEFAULT false,
	`two_factor_secret` varchar(255),
	`two_factor_backup_codes` json,
	`disabled_login_methods` json,
	`allowed_login_regions` json,
	`security_changed_at` datetime,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	`deleted_at` datetime,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `user_accounts` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`role` varchar(255) DEFAULT 'member',
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `user_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `user_accounts_user_account_idx` UNIQUE(`user_id`,`account_id`)
);
--> statement-breakpoint
CREATE TABLE `oauth_providers` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`provider` varchar(255) NOT NULL,
	`provider_user_id` varchar(255) NOT NULL,
	`access_token` varchar(255),
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `oauth_providers_id` PRIMARY KEY(`id`),
	CONSTRAINT `oauth_provider_user_idx` UNIQUE(`provider`,`provider_user_id`)
);
--> statement-breakpoint
CREATE TABLE `stacks` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`name` varchar(255),
	`template_slug` varchar(255),
	`status` varchar(255) DEFAULT 'active',
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	`deleted_at` datetime,
	CONSTRAINT `stacks_id` PRIMARY KEY(`id`)
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
	`max_users_per_account` int,
	`price_cents` int NOT NULL,
	`yearly_price_cents` int,
	`stripe_product_id` varchar(255),
	`stripe_price_ids` json,
	`name_translations` json,
	`description_translations` json,
	`scope` varchar(255) DEFAULT 'service',
	`volume_included_gb` int DEFAULT 0,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `billing_plans_id` PRIMARY KEY(`id`),
	CONSTRAINT `billing_plans_slug_unique` UNIQUE(`slug`)
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
	`trial_ends_at` datetime,
	`current_period_start` datetime,
	`current_period_end` datetime,
	`cancelled_at` datetime,
	`service_id` varchar(36),
	`stack_id` varchar(36),
	`payment_contact_name` varchar(255),
	`payment_contact_email` varchar(255),
	`past_due_since` datetime,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `subscriptions_id` PRIMARY KEY(`id`),
	CONSTRAINT `subscriptions_stripe_subscription_id_unique` UNIQUE(`stripe_subscription_id`)
);
--> statement-breakpoint
CREATE TABLE `usage_records` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`period_start` datetime,
	`period_end` datetime,
	`containers` int DEFAULT 0,
	`cpu_seconds` bigint DEFAULT 0,
	`memory_mb_hours` bigint DEFAULT 0,
	`storage_gb` int DEFAULT 0,
	`bandwidth_gb` int DEFAULT 0,
	`service_id` varchar(36),
	`stack_id` varchar(36),
	`recorded_at` datetime DEFAULT (now()),
	CONSTRAINT `usage_records_id` PRIMARY KEY(`id`)
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
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `pricing_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `location_multipliers` (
	`id` varchar(36) NOT NULL,
	`location_key` varchar(255) NOT NULL,
	`label` varchar(255) NOT NULL,
	`multiplier` int DEFAULT 100,
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `location_multipliers_id` PRIMARY KEY(`id`),
	CONSTRAINT `location_multipliers_location_key_unique` UNIQUE(`location_key`)
);
--> statement-breakpoint
CREATE TABLE `billing_config` (
	`id` varchar(36) NOT NULL,
	`billing_model` varchar(255) NOT NULL DEFAULT 'fixed',
	`allow_user_choice` boolean DEFAULT false,
	`allowed_cycles` json,
	`cycle_discounts` json,
	`trial_days` int DEFAULT 0,
	`suspension_grace_days` int DEFAULT 7,
	`deletion_grace_days` int DEFAULT 14,
	`auto_suspend_enabled` boolean DEFAULT true,
	`auto_delete_enabled` boolean DEFAULT false,
	`suspension_warning_days` int DEFAULT 2,
	`deletion_warning_days` int DEFAULT 7,
	`volume_deletion_enabled` boolean DEFAULT true,
	`purge_enabled` boolean DEFAULT true,
	`purge_retention_days` int DEFAULT 30,
	`allow_downgrade` boolean DEFAULT true,
	`deletion_billing_policy` varchar(20) NOT NULL DEFAULT 'end_of_period',
	`max_free_services_per_account` int,
	`domain_max_years` int DEFAULT 10,
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `billing_config_id` PRIMARY KEY(`id`)
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
	`max_container_disk_mb` int,
	`max_total_cpu_cores` int,
	`max_total_memory_mb` int,
	`max_backup_storage_gb` int,
	`backup_cluster_id` varchar(36),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `resource_limits_id` PRIMARY KEY(`id`)
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
	`max_free_services` int,
	`free_tier_cpu_limit` int,
	`free_tier_memory_limit` int,
	`free_tier_container_limit` int,
	`free_tier_storage_limit` int,
	`boost_cpu_limit` int,
	`boost_memory_limit` int,
	`boost_container_limit` int,
	`boost_storage_limit` int,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `account_billing_overrides_id` PRIMARY KEY(`id`),
	CONSTRAINT `account_billing_overrides_account_id_unique` UNIQUE(`account_id`)
);
--> statement-breakpoint
CREATE TABLE `webhook_events` (
	`id` varchar(36) NOT NULL,
	`stripe_event_id` varchar(255) NOT NULL,
	`event_type` varchar(255) NOT NULL,
	`processed_at` datetime DEFAULT (now()),
	`payload` json,
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `webhook_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `webhook_events_stripe_event_id_unique` UNIQUE(`stripe_event_id`)
);
--> statement-breakpoint
CREATE TABLE `billing_plan_prices` (
	`id` varchar(36) NOT NULL,
	`plan_id` varchar(36) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`price_cents` int NOT NULL,
	`cycle` varchar(20) NOT NULL DEFAULT 'monthly',
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `billing_plan_prices_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_billing_plan_prices_plan_currency_cycle` UNIQUE(`plan_id`,`currency`,`cycle`)
);
--> statement-breakpoint
CREATE TABLE `reseller_config` (
	`id` varchar(36) NOT NULL,
	`enabled` boolean DEFAULT false,
	`approval_mode` varchar(255) DEFAULT 'manual',
	`allow_sub_account_reselling` boolean DEFAULT false,
	`default_discount_type` varchar(255) DEFAULT 'percentage',
	`default_discount_percent` int DEFAULT 0,
	`default_discount_fixed` int DEFAULT 0,
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `reseller_config_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reseller_accounts` (
	`id` varchar(36) NOT NULL,
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
	`signup_slug` varchar(255),
	`custom_domain` varchar(255),
	`custom_domain_verified` boolean DEFAULT false,
	`custom_domain_token` varchar(255),
	`brand_name` varchar(255),
	`brand_logo_url` varchar(1024),
	`brand_primary_color` varchar(20),
	`brand_description` text,
	`approved_at` datetime,
	`approved_by` varchar(36),
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `reseller_accounts_id` PRIMARY KEY(`id`),
	CONSTRAINT `reseller_accounts_account_id_unique` UNIQUE(`account_id`),
	CONSTRAINT `reseller_accounts_signup_slug_unique` UNIQUE(`signup_slug`)
);
--> statement-breakpoint
CREATE TABLE `reseller_applications` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`message` text,
	`status` varchar(255) DEFAULT 'pending',
	`reviewed_by` varchar(36),
	`reviewed_at` datetime,
	`review_note` text,
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `reseller_applications_id` PRIMARY KEY(`id`)
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
	`github_webhook_id` int,
	`domain` varchar(255),
	`ssl_enabled` boolean DEFAULT true,
	`status` varchar(255) DEFAULT 'stopped',
	`node_constraint` varchar(255),
	`region` varchar(100),
	`placement_constraints` json,
	`update_parallelism` int DEFAULT 1,
	`update_delay` varchar(255) DEFAULT '10s',
	`rollback_on_failure` boolean DEFAULT true,
	`health_check` json,
	`cpu_limit` int,
	`memory_limit` int,
	`cpu_reservation` int,
	`memory_reservation` int,
	`restart_condition` varchar(20) DEFAULT 'on-failure',
	`restart_max_attempts` int DEFAULT 3,
	`restart_delay` varchar(20) DEFAULT '10s',
	`git_url` varchar(500),
	`git_branch` varchar(255),
	`git_token` varchar(500),
	`source_type` varchar(20),
	`source_path` varchar(500),
	`dockerfile` text,
	`registry_poll_enabled` boolean DEFAULT false,
	`registry_poll_interval` int DEFAULT 300,
	`registry_poll_digest` varchar(255),
	`registry_webhook_secret` varchar(255),
	`tags` json,
	`orchestrator` varchar(20),
	`robots_config` json,
	`nginx_config` text,
	`stack_id` varchar(36),
	`plan_id` varchar(36),
	`stopped_at` datetime,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	`deleted_at` datetime,
	CONSTRAINT `services_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `deployments` (
	`id` varchar(36) NOT NULL,
	`service_id` varchar(36) NOT NULL,
	`commit_sha` varchar(255),
	`status` varchar(255) DEFAULT 'pending',
	`log` text DEFAULT (''),
	`image_tag` varchar(255),
	`notes` text,
	`progress_step` varchar(50),
	`trigger` varchar(20),
	`started_at` datetime,
	`completed_at` datetime,
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `deployments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dns_zones` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`domain` varchar(255) NOT NULL,
	`verified` boolean DEFAULT false,
	`verification_token` varchar(255),
	`nameservers` json,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `dns_zones_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dns_records` (
	`id` varchar(36) NOT NULL,
	`zone_id` varchar(36) NOT NULL,
	`type` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`ttl` int DEFAULT 3600,
	`priority` int,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `dns_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `domain_registrars` (
	`id` varchar(36) NOT NULL,
	`provider` varchar(255) NOT NULL,
	`api_key` varchar(255) NOT NULL,
	`api_secret` varchar(255),
	`config` json,
	`enabled` boolean DEFAULT true,
	`created_by` varchar(36),
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `domain_registrars_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `domain_registrations` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`registrar_id` varchar(36),
	`domain` varchar(255) NOT NULL,
	`status` varchar(255) DEFAULT 'pending',
	`registered_at` datetime,
	`expires_at` datetime,
	`auto_renew` boolean DEFAULT true,
	`registrar_domain_id` varchar(255),
	`stripe_payment_id` varchar(255),
	`created_at` datetime DEFAULT (now()),
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
	`renewal_markup_type` varchar(20),
	`renewal_markup_value` int,
	`sell_registration_price` int NOT NULL,
	`sell_renewal_price` int NOT NULL,
	`enabled` boolean DEFAULT true,
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `domain_tld_pricing_id` PRIMARY KEY(`id`),
	CONSTRAINT `domain_tld_pricing_tld_unique` UNIQUE(`tld`)
);
--> statement-breakpoint
CREATE TABLE `domain_tld_currency_prices` (
	`id` varchar(36) NOT NULL,
	`tld_pricing_id` varchar(36) NOT NULL,
	`currency` varchar(3) NOT NULL,
	`sell_registration_price` int NOT NULL,
	`sell_renewal_price` int NOT NULL,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `domain_tld_currency_prices_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_tld_currency_prices_tld_currency` UNIQUE(`tld_pricing_id`,`currency`)
);
--> statement-breakpoint
CREATE TABLE `shared_domains` (
	`id` varchar(36) NOT NULL,
	`domain` varchar(255) NOT NULL,
	`enabled` boolean DEFAULT true,
	`pricing_type` varchar(20) NOT NULL DEFAULT 'free',
	`price` int NOT NULL DEFAULT 0,
	`currency` varchar(3) NOT NULL DEFAULT 'USD',
	`max_per_account` int NOT NULL DEFAULT 0,
	`created_by` varchar(36),
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `shared_domains_id` PRIMARY KEY(`id`),
	CONSTRAINT `shared_domains_domain_unique` UNIQUE(`domain`)
);
--> statement-breakpoint
CREATE TABLE `subdomain_claims` (
	`id` varchar(36) NOT NULL,
	`shared_domain_id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`subdomain` varchar(63) NOT NULL,
	`service_id` varchar(36),
	`status` varchar(20) NOT NULL DEFAULT 'active',
	`stripe_payment_id` varchar(255),
	`stripe_subscription_id` varchar(255),
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `subdomain_claims_id` PRIMARY KEY(`id`),
	CONSTRAINT `idx_subdomain_claims_unique` UNIQUE(`shared_domain_id`,`subdomain`)
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
	`ssh_allowed_ips` json,
	`last_heartbeat` datetime,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `nodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ssh_keys` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`public_key` text NOT NULL,
	`fingerprint` varchar(255) NOT NULL,
	`node_access` boolean DEFAULT false,
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `ssh_keys_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ssh_access_rules` (
	`id` varchar(36) NOT NULL,
	`service_id` varchar(36) NOT NULL,
	`allowed_ips` json,
	`enabled` boolean DEFAULT true,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `ssh_access_rules_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` varchar(36) NOT NULL,
	`user_id` varchar(36),
	`account_id` varchar(36),
	`action` varchar(255) NOT NULL,
	`event_type` varchar(255),
	`description` varchar(500),
	`resource_type` varchar(255),
	`resource_id` varchar(36),
	`resource_name` varchar(255),
	`actor_email` varchar(255),
	`ip_address` varchar(255),
	`source` varchar(50) DEFAULT 'user',
	`details` json,
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `audit_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backups` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`service_id` varchar(36),
	`parent_id` varchar(36),
	`level` int DEFAULT 0,
	`cluster_id` varchar(36),
	`type` varchar(255) DEFAULT 'manual',
	`status` varchar(255) DEFAULT 'pending',
	`storage_path` varchar(255),
	`storage_backend` varchar(255) DEFAULT 'nfs',
	`size_bytes` bigint DEFAULT 0,
	`contents` json,
	`created_at` datetime DEFAULT (now()),
	`expires_at` datetime,
	CONSTRAINT `backups_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `backup_schedules` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`service_id` varchar(36),
	`cluster_id` varchar(36),
	`cron` varchar(255) NOT NULL,
	`retention_days` int DEFAULT 30,
	`retention_count` int DEFAULT 10,
	`storage_backend` varchar(255) DEFAULT 'nfs',
	`enabled` boolean DEFAULT true,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	`last_run_at` datetime,
	CONSTRAINT `backup_schedules_id` PRIMARY KEY(`id`)
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
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `email_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `email_templates_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `email_log` (
	`id` varchar(36) NOT NULL,
	`template_slug` varchar(255) NOT NULL,
	`to_email` varchar(255) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`account_id` varchar(36),
	`status` varchar(255) DEFAULT 'queued',
	`sent_at` datetime,
	`error` text,
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `email_log_id` PRIMARY KEY(`id`)
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
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `app_templates_id` PRIMARY KEY(`id`),
	CONSTRAINT `app_templates_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
CREATE TABLE `platform_settings` (
	`id` varchar(36) NOT NULL,
	`key` varchar(255) NOT NULL,
	`value` json NOT NULL,
	`updated_at` datetime DEFAULT (now()),
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
	`disk_total` bigint NOT NULL DEFAULT 0,
	`disk_used` bigint NOT NULL DEFAULT 0,
	`disk_free` bigint NOT NULL DEFAULT 0,
	`disk_type` varchar(20) NOT NULL DEFAULT 'unknown',
	`recorded_at` datetime DEFAULT (now()),
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
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
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
	`last_used_at` datetime,
	`expires_at` datetime,
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `api_keys_id` PRIMARY KEY(`id`),
	CONSTRAINT `api_keys_key_hash_unique` UNIQUE(`key_hash`)
);
--> statement-breakpoint
CREATE TABLE `error_log` (
	`id` varchar(36) NOT NULL,
	`level` varchar(50) NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`method` varchar(10),
	`path` varchar(500),
	`status_code` int,
	`user_id` varchar(36),
	`ip` varchar(45),
	`user_agent` text,
	`metadata` json,
	`resolved` boolean DEFAULT false,
	`status` varchar(50) DEFAULT 'open',
	`self_healing_job_id` varchar(36),
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `error_log_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `storage_clusters` (
	`id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL DEFAULT 'default',
	`region` varchar(100),
	`scope` varchar(20) NOT NULL DEFAULT 'regional',
	`provider` varchar(255) NOT NULL DEFAULT 'local',
	`object_provider` varchar(255) NOT NULL DEFAULT 'local',
	`status` varchar(255) NOT NULL DEFAULT 'inactive',
	`replication_factor` int DEFAULT 3,
	`allow_services` boolean NOT NULL DEFAULT true,
	`allow_backups` boolean NOT NULL DEFAULT true,
	`config` json,
	`object_config` json,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `storage_clusters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `storage_nodes` (
	`id` varchar(36) NOT NULL,
	`cluster_id` varchar(36),
	`node_id` varchar(36),
	`hostname` varchar(255) NOT NULL,
	`ip_address` varchar(255) NOT NULL,
	`role` varchar(255) NOT NULL DEFAULT 'storage',
	`status` varchar(255) NOT NULL DEFAULT 'pending',
	`storage_path_root` varchar(255) DEFAULT '/srv/fleet-storage',
	`capacity_gb` int,
	`used_gb` int DEFAULT 0,
	`last_health_check` datetime,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `storage_nodes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `storage_volumes` (
	`id` varchar(36) NOT NULL,
	`cluster_id` varchar(36),
	`account_id` varchar(36) NOT NULL,
	`name` varchar(255) NOT NULL,
	`display_name` varchar(255),
	`size_gb` int NOT NULL,
	`used_gb` int DEFAULT 0,
	`provider` varchar(255) NOT NULL DEFAULT 'local',
	`provider_volume_id` varchar(255),
	`mount_path` varchar(255),
	`replica_count` int DEFAULT 1,
	`status` varchar(255) NOT NULL DEFAULT 'creating',
	`service_id` varchar(36),
	`stack_id` varchar(36),
	`is_unbound` boolean DEFAULT false,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	`deleted_at` datetime,
	CONSTRAINT `storage_volumes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `storage_migrations` (
	`id` varchar(36) NOT NULL,
	`from_provider` varchar(255) NOT NULL,
	`to_provider` varchar(255) NOT NULL,
	`status` varchar(255) NOT NULL DEFAULT 'pending',
	`progress` int DEFAULT 0,
	`total_bytes` bigint,
	`migrated_bytes` bigint DEFAULT 0,
	`current_item` varchar(255),
	`log` text,
	`started_at` datetime,
	`completed_at` datetime,
	`created_at` datetime DEFAULT (now()),
	CONSTRAINT `storage_migrations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `log_archives` (
	`id` varchar(36) NOT NULL,
	`log_type` varchar(50) NOT NULL,
	`account_id` varchar(36),
	`date_from` datetime NOT NULL,
	`date_to` datetime NOT NULL,
	`record_count` int NOT NULL DEFAULT 0,
	`size_bytes` bigint DEFAULT 0,
	`file_path` varchar(500) NOT NULL,
	`filename` varchar(255) NOT NULL,
	`status` varchar(50) DEFAULT 'completed',
	`created_at` datetime DEFAULT (now()),
	`expires_at` datetime,
	CONSTRAINT `log_archives_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `registry_credentials` (
	`id` varchar(36) NOT NULL,
	`account_id` varchar(36),
	`registry` varchar(255) NOT NULL,
	`username` varchar(255) NOT NULL,
	`password` text NOT NULL,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `registry_credentials_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `support_tickets` (
	`id` varchar(36) NOT NULL,
	`subject` varchar(255) NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'open',
	`priority` varchar(50) NOT NULL DEFAULT 'normal',
	`account_id` varchar(36) NOT NULL,
	`created_by` varchar(36) NOT NULL,
	`assigned_to` varchar(36),
	`closed_at` datetime,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `support_tickets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `support_ticket_messages` (
	`id` varchar(36) NOT NULL,
	`ticket_id` varchar(36) NOT NULL,
	`author_id` varchar(36) NOT NULL,
	`body` text NOT NULL,
	`sender_role` varchar(50) NOT NULL DEFAULT 'customer',
	`is_internal` boolean DEFAULT false,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `support_ticket_messages_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `self_healing_jobs` (
	`id` varchar(36) NOT NULL,
	`prompt` text NOT NULL,
	`status` varchar(50) NOT NULL DEFAULT 'pending',
	`base_branch` varchar(255),
	`working_branch` varchar(255),
	`pr_url` varchar(500),
	`pr_number` int,
	`commit_sha` varchar(255),
	`release_tag` varchar(100),
	`ci_status` varchar(50),
	`docker_service_id` varchar(255),
	`container_id` varchar(255),
	`log` text,
	`options` json NOT NULL DEFAULT ('{}'),
	`error` text,
	`created_by` varchar(36),
	`started_at` datetime,
	`completed_at` datetime,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `self_healing_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `service_analytics` (
	`id` varchar(36) NOT NULL,
	`service_id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`requests` bigint NOT NULL DEFAULT 0,
	`requests_2xx` bigint NOT NULL DEFAULT 0,
	`requests_3xx` bigint NOT NULL DEFAULT 0,
	`requests_4xx` bigint NOT NULL DEFAULT 0,
	`requests_5xx` bigint NOT NULL DEFAULT 0,
	`bytes_in` bigint NOT NULL DEFAULT 0,
	`bytes_out` bigint NOT NULL DEFAULT 0,
	`avg_response_time_ms` bigint NOT NULL DEFAULT 0,
	`p95_response_time_ms` bigint NOT NULL DEFAULT 0,
	`io_read_bytes` bigint NOT NULL DEFAULT 0,
	`io_write_bytes` bigint NOT NULL DEFAULT 0,
	`period` varchar(10) NOT NULL DEFAULT '5m',
	`recorded_at` datetime NOT NULL DEFAULT (now()),
	CONSTRAINT `service_analytics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `visitor_analytics` (
	`id` varchar(36) NOT NULL,
	`service_id` varchar(36) NOT NULL,
	`account_id` varchar(36) NOT NULL,
	`unique_visitors` bigint NOT NULL DEFAULT 0,
	`page_views` bigint NOT NULL DEFAULT 0,
	`top_paths` json NOT NULL DEFAULT ('[]'),
	`top_referrers` json NOT NULL DEFAULT ('[]'),
	`browsers` json NOT NULL DEFAULT ('{}'),
	`devices` json NOT NULL DEFAULT ('{}'),
	`countries` json NOT NULL DEFAULT ('{}'),
	`period` varchar(10) NOT NULL DEFAULT '5m',
	`recorded_at` datetime NOT NULL DEFAULT (now()),
	CONSTRAINT `visitor_analytics_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_admin_role_id_admin_roles_id_fk` FOREIGN KEY (`admin_role_id`) REFERENCES `admin_roles`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `user_accounts` ADD CONSTRAINT `user_accounts_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `user_accounts` ADD CONSTRAINT `user_accounts_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `oauth_providers` ADD CONSTRAINT `oauth_providers_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `stacks` ADD CONSTRAINT `stacks_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_plan_id_billing_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `billing_plans`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_stack_id_stacks_id_fk` FOREIGN KEY (`stack_id`) REFERENCES `stacks`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `usage_records` ADD CONSTRAINT `usage_records_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `resource_limits` ADD CONSTRAINT `resource_limits_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `account_billing_overrides` ADD CONSTRAINT `account_billing_overrides_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `billing_plan_prices` ADD CONSTRAINT `billing_plan_prices_plan_id_billing_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `billing_plans`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `reseller_accounts` ADD CONSTRAINT `reseller_accounts_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `reseller_applications` ADD CONSTRAINT `reseller_applications_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `services` ADD CONSTRAINT `services_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `services` ADD CONSTRAINT `services_plan_id_billing_plans_id_fk` FOREIGN KEY (`plan_id`) REFERENCES `billing_plans`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `deployments` ADD CONSTRAINT `deployments_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `dns_zones` ADD CONSTRAINT `dns_zones_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `dns_records` ADD CONSTRAINT `dns_records_zone_id_dns_zones_id_fk` FOREIGN KEY (`zone_id`) REFERENCES `dns_zones`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `domain_registrars` ADD CONSTRAINT `domain_registrars_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `domain_registrations` ADD CONSTRAINT `domain_registrations_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `domain_registrations` ADD CONSTRAINT `domain_registrations_registrar_id_domain_registrars_id_fk` FOREIGN KEY (`registrar_id`) REFERENCES `domain_registrars`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `domain_tld_currency_prices` ADD CONSTRAINT `dtcp_tld_pricing_id_domain_tld_pricing_id_fk` FOREIGN KEY (`tld_pricing_id`) REFERENCES `domain_tld_pricing`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `shared_domains` ADD CONSTRAINT `shared_domains_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `subdomain_claims` ADD CONSTRAINT `subdomain_claims_shared_domain_id_shared_domains_id_fk` FOREIGN KEY (`shared_domain_id`) REFERENCES `shared_domains`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `subdomain_claims` ADD CONSTRAINT `subdomain_claims_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `subdomain_claims` ADD CONSTRAINT `subdomain_claims_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `ssh_keys` ADD CONSTRAINT `ssh_keys_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `ssh_access_rules` ADD CONSTRAINT `ssh_access_rules_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `audit_log` ADD CONSTRAINT `audit_log_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `backups` ADD CONSTRAINT `backups_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `backups` ADD CONSTRAINT `backups_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `backup_schedules` ADD CONSTRAINT `backup_schedules_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `backup_schedules` ADD CONSTRAINT `backup_schedules_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `email_log` ADD CONSTRAINT `email_log_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `email_templates` ADD CONSTRAINT `email_templates_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `app_templates` ADD CONSTRAINT `app_templates_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `node_metrics` ADD CONSTRAINT `node_metrics_node_id_nodes_id_fk` FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `api_keys` ADD CONSTRAINT `api_keys_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `storage_nodes` ADD CONSTRAINT `storage_nodes_cluster_id_storage_clusters_id_fk` FOREIGN KEY (`cluster_id`) REFERENCES `storage_clusters`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `storage_nodes` ADD CONSTRAINT `storage_nodes_node_id_nodes_id_fk` FOREIGN KEY (`node_id`) REFERENCES `nodes`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `storage_volumes` ADD CONSTRAINT `storage_volumes_cluster_id_storage_clusters_id_fk` FOREIGN KEY (`cluster_id`) REFERENCES `storage_clusters`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `storage_volumes` ADD CONSTRAINT `storage_volumes_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `registry_credentials` ADD CONSTRAINT `registry_credentials_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `support_tickets` ADD CONSTRAINT `support_tickets_assigned_to_users_id_fk` FOREIGN KEY (`assigned_to`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `support_ticket_messages` ADD CONSTRAINT `support_ticket_messages_ticket_id_support_tickets_id_fk` FOREIGN KEY (`ticket_id`) REFERENCES `support_tickets`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `support_ticket_messages` ADD CONSTRAINT `support_ticket_messages_author_id_users_id_fk` FOREIGN KEY (`author_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `self_healing_jobs` ADD CONSTRAINT `self_healing_jobs_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `service_analytics` ADD CONSTRAINT `service_analytics_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `service_analytics` ADD CONSTRAINT `service_analytics_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `visitor_analytics` ADD CONSTRAINT `visitor_analytics_service_id_services_id_fk` FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `visitor_analytics` ADD CONSTRAINT `visitor_analytics_account_id_accounts_id_fk` FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `idx_accounts_deleted_at` ON `accounts` (`deleted_at`);
--> statement-breakpoint
CREATE INDEX `idx_accounts_scheduled_deletion` ON `accounts` (`scheduled_deletion_at`);
--> statement-breakpoint
CREATE INDEX `idx_stacks_account_id` ON `stacks` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_stacks_deleted_at` ON `stacks` (`deleted_at`);
--> statement-breakpoint
CREATE INDEX `idx_subscriptions_account_id` ON `subscriptions` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_subscriptions_status` ON `subscriptions` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_subscriptions_past_due_since` ON `subscriptions` (`past_due_since`);
--> statement-breakpoint
CREATE INDEX `idx_subscriptions_service_id` ON `subscriptions` (`service_id`);
--> statement-breakpoint
CREATE INDEX `idx_subscriptions_stack_id` ON `subscriptions` (`stack_id`);
--> statement-breakpoint
CREATE INDEX `idx_usage_records_account_id` ON `usage_records` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_usage_records_service_id` ON `usage_records` (`service_id`);
--> statement-breakpoint
CREATE INDEX `idx_usage_records_stack_id` ON `usage_records` (`stack_id`);
--> statement-breakpoint
CREATE INDEX `idx_resource_limits_account_id` ON `resource_limits` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_reseller_accounts_status` ON `reseller_accounts` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_reseller_applications_account_id` ON `reseller_applications` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_reseller_applications_status` ON `reseller_applications` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_services_account_id` ON `services` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_services_status` ON `services` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_services_stack_id` ON `services` (`stack_id`);
--> statement-breakpoint
CREATE INDEX `idx_services_github_autodeploy` ON `services` (`github_repo`, `github_branch`, `auto_deploy`);
--> statement-breakpoint
CREATE INDEX `idx_services_deleted_at` ON `services` (`deleted_at`);
--> statement-breakpoint
CREATE INDEX `idx_services_plan_id` ON `services` (`plan_id`);
--> statement-breakpoint
CREATE INDEX `idx_deployments_service_id` ON `deployments` (`service_id`);
--> statement-breakpoint
CREATE INDEX `idx_deployments_status` ON `deployments` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_dns_zones_account_id` ON `dns_zones` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_dns_records_zone_id` ON `dns_records` (`zone_id`);
--> statement-breakpoint
CREATE INDEX `idx_domain_registrations_account_id` ON `domain_registrations` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_domain_registrations_registrar_id` ON `domain_registrations` (`registrar_id`);
--> statement-breakpoint
CREATE INDEX `idx_subdomain_claims_shared_domain_id` ON `subdomain_claims` (`shared_domain_id`);
--> statement-breakpoint
CREATE INDEX `idx_subdomain_claims_account_id` ON `subdomain_claims` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_nodes_last_heartbeat` ON `nodes` (`last_heartbeat`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_keys_user_id` ON `ssh_keys` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_ssh_access_rules_service_id` ON `ssh_access_rules` (`service_id`);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_account_id` ON `audit_log` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_created_at` ON `audit_log` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_audit_log_event_type` ON `audit_log` (`event_type`);
--> statement-breakpoint
CREATE INDEX `idx_backups_account_id` ON `backups` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_backups_service_id` ON `backups` (`service_id`);
--> statement-breakpoint
CREATE INDEX `idx_backups_parent_id` ON `backups` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `idx_backup_schedules_account_id` ON `backup_schedules` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_backup_schedules_service_id` ON `backup_schedules` (`service_id`);
--> statement-breakpoint
CREATE INDEX `idx_email_log_account_id` ON `email_log` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_email_log_status` ON `email_log` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_node_metrics_node_id` ON `node_metrics` (`node_id`);
--> statement-breakpoint
CREATE INDEX `idx_node_metrics_node_recorded` ON `node_metrics` (`node_id`, `recorded_at`);
--> statement-breakpoint
CREATE INDEX `idx_notifications_account_id` ON `notifications` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_id` ON `notifications` (`user_id`);
--> statement-breakpoint
CREATE INDEX `idx_api_keys_account_id` ON `api_keys` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_error_log_created_at` ON `error_log` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_error_log_level` ON `error_log` (`level`);
--> statement-breakpoint
CREATE INDEX `idx_error_log_resolved` ON `error_log` (`resolved`);
--> statement-breakpoint
CREATE INDEX `idx_error_log_status` ON `error_log` (`status`);
--> statement-breakpoint
CREATE INDEX `storage_nodes_cluster_idx` ON `storage_nodes` (`cluster_id`);
--> statement-breakpoint
CREATE INDEX `idx_storage_nodes_last_health_check` ON `storage_nodes` (`last_health_check`);
--> statement-breakpoint
CREATE INDEX `storage_volumes_account_idx` ON `storage_volumes` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_storage_volumes_deleted_at` ON `storage_volumes` (`deleted_at`);
--> statement-breakpoint
CREATE INDEX `idx_storage_volumes_service_id` ON `storage_volumes` (`service_id`);
--> statement-breakpoint
CREATE INDEX `idx_storage_volumes_stack_id` ON `storage_volumes` (`stack_id`);
--> statement-breakpoint
CREATE INDEX `idx_log_archives_log_type` ON `log_archives` (`log_type`);
--> statement-breakpoint
CREATE INDEX `idx_log_archives_account_id` ON `log_archives` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_log_archives_created_at` ON `log_archives` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_log_archives_expires_at` ON `log_archives` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `idx_registry_credentials_account_id` ON `registry_credentials` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_support_tickets_account_id` ON `support_tickets` (`account_id`);
--> statement-breakpoint
CREATE INDEX `idx_support_tickets_status` ON `support_tickets` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_support_tickets_assigned_to` ON `support_tickets` (`assigned_to`);
--> statement-breakpoint
CREATE INDEX `idx_support_tickets_created_by` ON `support_tickets` (`created_by`);
--> statement-breakpoint
CREATE INDEX `idx_support_ticket_messages_ticket_id` ON `support_ticket_messages` (`ticket_id`);
--> statement-breakpoint
CREATE INDEX `idx_self_healing_jobs_status` ON `self_healing_jobs` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_self_healing_jobs_created_by` ON `self_healing_jobs` (`created_by`);
--> statement-breakpoint
CREATE INDEX `idx_self_healing_jobs_created_at` ON `self_healing_jobs` (`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_service_analytics_service_recorded` ON `service_analytics` (`service_id`, `recorded_at`);
--> statement-breakpoint
CREATE INDEX `idx_service_analytics_account_recorded` ON `service_analytics` (`account_id`, `recorded_at`);
--> statement-breakpoint
CREATE INDEX `idx_service_analytics_recorded_at` ON `service_analytics` (`recorded_at`);
--> statement-breakpoint
CREATE INDEX `idx_service_analytics_period_recorded` ON `service_analytics` (`period`, `recorded_at`);
--> statement-breakpoint
CREATE INDEX `idx_visitor_analytics_service_recorded` ON `visitor_analytics` (`service_id`, `recorded_at`);
--> statement-breakpoint
CREATE INDEX `idx_visitor_analytics_account_recorded` ON `visitor_analytics` (`account_id`, `recorded_at`);
--> statement-breakpoint
CREATE INDEX `idx_visitor_analytics_recorded_at` ON `visitor_analytics` (`recorded_at`);
--> statement-breakpoint
CREATE TABLE `status_posts` (
	`id` varchar(36) NOT NULL,
	`icon` varchar(255) NOT NULL DEFAULT 'info',
	`severity` varchar(255) NOT NULL DEFAULT 'info',
	`status` varchar(255) NOT NULL DEFAULT 'draft',
	`affected_services` json,
	`published_at` datetime,
	`created_by` varchar(36),
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `status_posts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `status_post_translations` (
	`id` varchar(36) NOT NULL,
	`post_id` varchar(36) NOT NULL,
	`locale` varchar(10) NOT NULL,
	`title` varchar(255) NOT NULL,
	`body` text NOT NULL,
	`created_at` datetime DEFAULT (now()),
	`updated_at` datetime DEFAULT (now()),
	CONSTRAINT `status_post_translations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `uptime_snapshots` (
	`id` varchar(36) NOT NULL,
	`service` varchar(255) NOT NULL,
	`status` varchar(255) NOT NULL,
	`response_ms` int,
	`recorded_at` datetime DEFAULT (now()),
	CONSTRAINT `uptime_snapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `status_posts` ADD CONSTRAINT `status_posts_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE `status_post_translations` ADD CONSTRAINT `spt_post_id_status_posts_id_fk` FOREIGN KEY (`post_id`) REFERENCES `status_posts`(`id`) ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX `idx_status_posts_status` ON `status_posts` (`status`);
--> statement-breakpoint
CREATE INDEX `idx_status_posts_published_at` ON `status_posts` (`published_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_status_post_translations_post_locale` ON `status_post_translations` (`post_id`, `locale`);
--> statement-breakpoint
CREATE INDEX `idx_uptime_snapshots_service_recorded` ON `uptime_snapshots` (`service`, `recorded_at`);
