-- Add soft delete columns
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp;

-- Add missing user columns
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified" boolean DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verify_token" varchar;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verify_expires" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_reset_token" varchar;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "password_reset_expires" timestamp;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_enabled" boolean DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_secret" varchar;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "two_factor_backup_codes" jsonb;

-- Add missing service columns (resource limits)
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "cpu_limit" integer;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "memory_limit" integer;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "cpu_reservation" integer;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "memory_reservation" integer;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "stopped_at" timestamp;

-- Add unique constraint on subscriptions.stripe_subscription_id
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE ("stripe_subscription_id");

-- Fix FK cascades: user_accounts should cascade on user/account delete
ALTER TABLE "user_accounts" DROP CONSTRAINT IF EXISTS "user_accounts_user_id_users_id_fk";
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "user_accounts" DROP CONSTRAINT IF EXISTS "user_accounts_account_id_accounts_id_fk";
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Services should cascade on account delete
ALTER TABLE "services" DROP CONSTRAINT IF EXISTS "services_account_id_accounts_id_fk";
ALTER TABLE "services" ADD CONSTRAINT "services_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Deployments should cascade on service delete
ALTER TABLE "deployments" DROP CONSTRAINT IF EXISTS "deployments_service_id_services_id_fk";
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- API keys should cascade on account delete and set null on user delete
ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_account_id_accounts_id_fk";
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "api_keys" DROP CONSTRAINT IF EXISTS "api_keys_created_by_users_id_fk";
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- SSH keys should cascade on user delete
ALTER TABLE "ssh_keys" DROP CONSTRAINT IF EXISTS "ssh_keys_user_id_users_id_fk";
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- OAuth providers should cascade on user delete
ALTER TABLE "oauth_providers" DROP CONSTRAINT IF EXISTS "oauth_providers_user_id_users_id_fk";
ALTER TABLE "oauth_providers" ADD CONSTRAINT "oauth_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- DNS zones should cascade on account delete
ALTER TABLE "dns_zones" DROP CONSTRAINT IF EXISTS "dns_zones_account_id_accounts_id_fk";
ALTER TABLE "dns_zones" ADD CONSTRAINT "dns_zones_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- DNS records should cascade on zone delete
ALTER TABLE "dns_records" DROP CONSTRAINT IF EXISTS "dns_records_zone_id_dns_zones_id_fk";
ALTER TABLE "dns_records" ADD CONSTRAINT "dns_records_zone_id_dns_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "dns_zones"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Backups should cascade on account delete, set null on service delete
ALTER TABLE "backups" DROP CONSTRAINT IF EXISTS "backups_account_id_accounts_id_fk";
ALTER TABLE "backups" ADD CONSTRAINT "backups_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "backups" DROP CONSTRAINT IF EXISTS "backups_service_id_services_id_fk";
ALTER TABLE "backups" ADD CONSTRAINT "backups_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Backup schedules should cascade on account delete, set null on service delete
ALTER TABLE "backup_schedules" DROP CONSTRAINT IF EXISTS "backup_schedules_account_id_accounts_id_fk";
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "backup_schedules" DROP CONSTRAINT IF EXISTS "backup_schedules_service_id_services_id_fk";
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Notifications should cascade on account delete, set null on user delete
ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_account_id_accounts_id_fk";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "notifications" DROP CONSTRAINT IF EXISTS "notifications_user_id_users_id_fk";
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Audit log should set null on user/account delete (preserve history)
ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_user_id_users_id_fk";
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "audit_log" DROP CONSTRAINT IF EXISTS "audit_log_account_id_accounts_id_fk";
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- Subscriptions should cascade on account delete
ALTER TABLE "subscriptions" DROP CONSTRAINT IF EXISTS "subscriptions_account_id_accounts_id_fk";
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Usage records should cascade on account delete
ALTER TABLE "usage_records" DROP CONSTRAINT IF EXISTS "usage_records_account_id_accounts_id_fk";
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- SSH access rules should cascade on service delete
ALTER TABLE "ssh_access_rules" DROP CONSTRAINT IF EXISTS "ssh_access_rules_service_id_services_id_fk";
ALTER TABLE "ssh_access_rules" ADD CONSTRAINT "ssh_access_rules_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "services"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Node metrics should cascade on node delete
ALTER TABLE "node_metrics" DROP CONSTRAINT IF EXISTS "node_metrics_node_id_nodes_id_fk";
ALTER TABLE "node_metrics" ADD CONSTRAINT "node_metrics_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "nodes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Resource limits should cascade on account delete
ALTER TABLE "resource_limits" DROP CONSTRAINT IF EXISTS "resource_limits_account_id_accounts_id_fk";
ALTER TABLE "resource_limits" ADD CONSTRAINT "resource_limits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Billing overrides should cascade on account delete
ALTER TABLE "account_billing_overrides" DROP CONSTRAINT IF EXISTS "account_billing_overrides_account_id_accounts_id_fk";
ALTER TABLE "account_billing_overrides" ADD CONSTRAINT "account_billing_overrides_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- Session invalidation support
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "security_changed_at" timestamp;

-- Webhook idempotency unique constraint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_webhook_events_stripe_event_id" ON "webhook_events" ("stripe_event_id");

-- Create indexes for soft delete queries (WHERE deleted_at IS NULL is common)
CREATE INDEX IF NOT EXISTS "accounts_deleted_at_idx" ON "accounts" ("deleted_at") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "users_deleted_at_idx" ON "users" ("deleted_at") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "services_deleted_at_idx" ON "services" ("deleted_at") WHERE "deleted_at" IS NULL;
CREATE INDEX IF NOT EXISTS "services_account_id_idx" ON "services" ("account_id") WHERE "deleted_at" IS NULL;
