-- Y2038 fix: Convert all TIMESTAMP columns to DATETIME
-- MySQL TIMESTAMP is stored as 32-bit Unix epoch (max 2038-01-19 03:14:07 UTC)
-- DATETIME supports up to 9999-12-31 23:59:59

ALTER TABLE `accounts` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `accounts` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `accounts` MODIFY COLUMN `suspended_at` datetime;
ALTER TABLE `accounts` MODIFY COLUMN `scheduled_deletion_at` datetime;
ALTER TABLE `accounts` MODIFY COLUMN `deleted_at` datetime;
--> statement-breakpoint
ALTER TABLE `admin_roles` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `admin_roles` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `api_keys` MODIFY COLUMN `last_used_at` datetime;
ALTER TABLE `api_keys` MODIFY COLUMN `expires_at` datetime;
ALTER TABLE `api_keys` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `app_templates` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `app_templates` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `audit_log` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `backups` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `backups` MODIFY COLUMN `expires_at` datetime;
--> statement-breakpoint
ALTER TABLE `backup_schedules` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `backup_schedules` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `backup_schedules` MODIFY COLUMN `last_run_at` datetime;
--> statement-breakpoint
ALTER TABLE `billing_plans` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `billing_plans` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `billing_plan_prices` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `billing_plan_prices` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `billing_config` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `subscriptions` MODIFY COLUMN `trial_ends_at` datetime;
ALTER TABLE `subscriptions` MODIFY COLUMN `current_period_start` datetime;
ALTER TABLE `subscriptions` MODIFY COLUMN `current_period_end` datetime;
ALTER TABLE `subscriptions` MODIFY COLUMN `cancelled_at` datetime;
ALTER TABLE `subscriptions` MODIFY COLUMN `past_due_since` datetime;
ALTER TABLE `subscriptions` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `subscriptions` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `usage_records` MODIFY COLUMN `period_start` datetime;
ALTER TABLE `usage_records` MODIFY COLUMN `period_end` datetime;
ALTER TABLE `usage_records` MODIFY COLUMN `recorded_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `pricing_config` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `location_multipliers` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `resource_limits` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `account_billing_overrides` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `account_billing_overrides` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `webhook_events` MODIFY COLUMN `processed_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `webhook_events` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `reseller_config` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `reseller_accounts` MODIFY COLUMN `approved_at` datetime;
ALTER TABLE `reseller_accounts` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `reseller_accounts` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `reseller_applications` MODIFY COLUMN `reviewed_at` datetime;
ALTER TABLE `reseller_applications` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `deployments` MODIFY COLUMN `started_at` datetime;
ALTER TABLE `deployments` MODIFY COLUMN `completed_at` datetime;
ALTER TABLE `deployments` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `dns_zones` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `dns_zones` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `dns_records` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `dns_records` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `domain_registrars` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `domain_registrations` MODIFY COLUMN `registered_at` datetime;
ALTER TABLE `domain_registrations` MODIFY COLUMN `expires_at` datetime;
ALTER TABLE `domain_registrations` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `domain_tld_pricing` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `domain_tld_pricing` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `domain_tld_currency_prices` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `domain_tld_currency_prices` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `email_templates` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `email_log` MODIFY COLUMN `sent_at` datetime;
ALTER TABLE `email_log` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `error_log` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `log_archives` MODIFY COLUMN `date_from` datetime NOT NULL;
ALTER TABLE `log_archives` MODIFY COLUMN `date_to` datetime NOT NULL;
ALTER TABLE `log_archives` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `log_archives` MODIFY COLUMN `expires_at` datetime;
--> statement-breakpoint
ALTER TABLE `node_metrics` MODIFY COLUMN `recorded_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `nodes` MODIFY COLUMN `last_heartbeat` datetime;
ALTER TABLE `nodes` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `nodes` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `notifications` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `oauth_providers` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `platform_settings` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `registry_credentials` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `registry_credentials` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `self_healing_jobs` MODIFY COLUMN `started_at` datetime;
ALTER TABLE `self_healing_jobs` MODIFY COLUMN `completed_at` datetime;
ALTER TABLE `self_healing_jobs` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `self_healing_jobs` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `services` MODIFY COLUMN `stopped_at` datetime;
ALTER TABLE `services` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `services` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `services` MODIFY COLUMN `deleted_at` datetime;
--> statement-breakpoint
ALTER TABLE `service_analytics` MODIFY COLUMN `recorded_at` datetime DEFAULT CURRENT_TIMESTAMP NOT NULL;
--> statement-breakpoint
ALTER TABLE `shared_domains` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `shared_domains` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `ssh_keys` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `ssh_access_rules` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `ssh_access_rules` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `stacks` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `stacks` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `stacks` MODIFY COLUMN `deleted_at` datetime;
--> statement-breakpoint
ALTER TABLE `status_posts` MODIFY COLUMN `published_at` datetime;
ALTER TABLE `status_posts` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `status_posts` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `status_post_translations` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `status_post_translations` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `storage_clusters` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `storage_clusters` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `storage_nodes` MODIFY COLUMN `last_health_check` datetime;
ALTER TABLE `storage_nodes` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `storage_nodes` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `storage_volumes` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `storage_volumes` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `storage_volumes` MODIFY COLUMN `deleted_at` datetime;
--> statement-breakpoint
ALTER TABLE `storage_migrations` MODIFY COLUMN `started_at` datetime;
ALTER TABLE `storage_migrations` MODIFY COLUMN `completed_at` datetime;
ALTER TABLE `storage_migrations` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `subdomain_claims` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `subdomain_claims` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `support_tickets` MODIFY COLUMN `closed_at` datetime;
ALTER TABLE `support_tickets` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `support_tickets` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `support_ticket_messages` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `support_ticket_messages` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `uptime_snapshots` MODIFY COLUMN `recorded_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `user_accounts` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
--> statement-breakpoint
ALTER TABLE `users` MODIFY COLUMN `email_verify_expires` datetime;
ALTER TABLE `users` MODIFY COLUMN `password_reset_expires` datetime;
ALTER TABLE `users` MODIFY COLUMN `security_changed_at` datetime;
ALTER TABLE `users` MODIFY COLUMN `created_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `users` MODIFY COLUMN `updated_at` datetime DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE `users` MODIFY COLUMN `deleted_at` datetime;
--> statement-breakpoint
ALTER TABLE `visitor_analytics` MODIFY COLUMN `recorded_at` datetime DEFAULT CURRENT_TIMESTAMP NOT NULL;
