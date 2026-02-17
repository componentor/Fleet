CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255),
	"slug" varchar(255),
	"parent_id" uuid,
	"path" text,
	"depth" integer DEFAULT 0,
	"trust_revocable" boolean DEFAULT false,
	"stripe_customer_id" varchar,
	"stripe_connect_account_id" varchar,
	"plan" jsonb,
	"status" varchar DEFAULT 'active',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "accounts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"name" varchar NOT NULL,
	"key_prefix" varchar NOT NULL,
	"key_hash" varchar NOT NULL,
	"scopes" jsonb DEFAULT '["*"]'::jsonb,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"account_id" uuid,
	"action" varchar NOT NULL,
	"resource_type" varchar,
	"resource_id" uuid,
	"ip_address" varchar,
	"details" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "backup_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"service_id" uuid,
	"cron" varchar NOT NULL,
	"retention_days" integer DEFAULT 30,
	"retention_count" integer DEFAULT 10,
	"storage_backend" varchar DEFAULT 'nfs',
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"last_run_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "backups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"service_id" uuid,
	"type" varchar DEFAULT 'manual',
	"status" varchar DEFAULT 'pending',
	"storage_path" varchar,
	"storage_backend" varchar DEFAULT 'nfs',
	"size_bytes" bigint DEFAULT 0,
	"contents" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "account_billing_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"discount_percent" integer DEFAULT 0,
	"custom_price_cents" integer,
	"notes" text,
	"cpu_cents_per_hour_override" integer,
	"memory_cents_per_gb_hour_override" integer,
	"storage_cents_per_gb_month_override" integer,
	"bandwidth_cents_per_gb_override" integer,
	"container_cents_per_hour_override" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "account_billing_overrides_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE "billing_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"billing_model" varchar DEFAULT 'fixed' NOT NULL,
	"allow_user_choice" boolean DEFAULT false,
	"allowed_cycles" jsonb DEFAULT '["monthly","yearly"]'::jsonb,
	"cycle_discounts" jsonb DEFAULT '{}'::jsonb,
	"trial_days" integer DEFAULT 0,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "billing_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"slug" varchar NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0,
	"is_default" boolean DEFAULT false,
	"is_free" boolean DEFAULT false,
	"visible" boolean DEFAULT true,
	"cpu_limit" integer NOT NULL,
	"memory_limit" integer NOT NULL,
	"container_limit" integer NOT NULL,
	"storage_limit" integer NOT NULL,
	"bandwidth_limit" integer,
	"price_cents" integer NOT NULL,
	"stripe_product_id" varchar,
	"stripe_price_ids" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "billing_plans_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "location_multipliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"location_key" varchar NOT NULL,
	"label" varchar NOT NULL,
	"multiplier" integer DEFAULT 100,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "location_multipliers_location_key_unique" UNIQUE("location_key")
);
--> statement-breakpoint
CREATE TABLE "pricing_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cpu_cents_per_hour" integer DEFAULT 0,
	"memory_cents_per_gb_hour" integer DEFAULT 0,
	"storage_cents_per_gb_month" integer DEFAULT 0,
	"bandwidth_cents_per_gb" integer DEFAULT 0,
	"container_cents_per_hour" integer DEFAULT 0,
	"domain_markup_percent" integer DEFAULT 0,
	"backup_storage_cents_per_gb" integer DEFAULT 0,
	"location_pricing_enabled" boolean DEFAULT false,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "resource_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid,
	"max_cpu_per_container" integer,
	"max_memory_per_container" integer,
	"max_replicas" integer,
	"max_containers" integer,
	"max_storage_gb" integer,
	"max_bandwidth_gb" integer,
	"max_nfs_storage_gb" integer,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"plan_id" uuid,
	"billing_model" varchar DEFAULT 'fixed',
	"stripe_subscription_id" varchar,
	"stripe_customer_id" varchar,
	"billing_cycle" varchar DEFAULT 'monthly',
	"status" varchar DEFAULT 'active',
	"trial_ends_at" timestamp,
	"current_period_start" timestamp,
	"current_period_end" timestamp,
	"cancelled_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"period_start" timestamp,
	"period_end" timestamp,
	"containers" integer DEFAULT 0,
	"cpu_seconds" bigint DEFAULT 0,
	"memory_mb_hours" bigint DEFAULT 0,
	"storage_gb" integer DEFAULT 0,
	"bandwidth_gb" integer DEFAULT 0,
	"recorded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dns_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"zone_id" uuid NOT NULL,
	"type" varchar NOT NULL,
	"name" varchar NOT NULL,
	"content" varchar NOT NULL,
	"ttl" integer DEFAULT 3600,
	"priority" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dns_zones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"domain" varchar(255) NOT NULL,
	"verified" boolean DEFAULT false,
	"nameservers" jsonb DEFAULT '[]'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "domain_registrars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar NOT NULL,
	"api_key" varchar NOT NULL,
	"api_secret" varchar,
	"config" jsonb DEFAULT '{}'::jsonb,
	"enabled" boolean DEFAULT true,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "domain_registrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"registrar_id" uuid NOT NULL,
	"domain" varchar NOT NULL,
	"status" varchar DEFAULT 'pending',
	"registered_at" timestamp,
	"expires_at" timestamp,
	"auto_renew" boolean DEFAULT true,
	"registrar_domain_id" varchar,
	"stripe_payment_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "domain_tld_pricing" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tld" varchar(63) NOT NULL,
	"provider_registration_price" integer NOT NULL,
	"provider_renewal_price" integer NOT NULL,
	"markup_type" varchar(20) DEFAULT 'percentage' NOT NULL,
	"markup_value" integer DEFAULT 20 NOT NULL,
	"sell_registration_price" integer NOT NULL,
	"sell_renewal_price" integer NOT NULL,
	"enabled" boolean DEFAULT true,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "domain_tld_pricing_tld_unique" UNIQUE("tld")
);
--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_slug" varchar NOT NULL,
	"to_email" varchar NOT NULL,
	"subject" varchar NOT NULL,
	"account_id" uuid,
	"status" varchar DEFAULT 'queued',
	"sent_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar NOT NULL,
	"subject" varchar NOT NULL,
	"body_html" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"account_id" uuid,
	"enabled" boolean DEFAULT true,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "email_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "oauth_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" varchar NOT NULL,
	"provider_user_id" varchar NOT NULL,
	"access_token" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"role" varchar DEFAULT 'member',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255),
	"password_hash" varchar,
	"name" varchar(255),
	"avatar_url" varchar,
	"is_super" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"commit_sha" varchar,
	"status" varchar DEFAULT 'pending',
	"log" text DEFAULT '',
	"image_tag" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"image" varchar NOT NULL,
	"replicas" integer DEFAULT 1,
	"env" jsonb DEFAULT '{}'::jsonb,
	"ports" jsonb DEFAULT '[]'::jsonb,
	"volumes" jsonb DEFAULT '[]'::jsonb,
	"docker_service_id" varchar,
	"github_repo" varchar,
	"github_branch" varchar,
	"auto_deploy" boolean DEFAULT false,
	"domain" varchar,
	"ssl_enabled" boolean DEFAULT true,
	"status" varchar DEFAULT 'stopped',
	"node_constraint" varchar,
	"placement_constraints" jsonb DEFAULT '[]'::jsonb,
	"update_parallelism" integer DEFAULT 1,
	"update_delay" varchar DEFAULT '10s',
	"rollback_on_failure" boolean DEFAULT true,
	"health_check" jsonb,
	"cpu_limit" integer,
	"memory_limit" integer,
	"cpu_reservation" integer,
	"memory_reservation" integer,
	"stopped_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hostname" varchar NOT NULL,
	"ip_address" varchar NOT NULL,
	"docker_node_id" varchar,
	"role" varchar DEFAULT 'worker',
	"status" varchar DEFAULT 'active',
	"labels" jsonb DEFAULT '{}'::jsonb,
	"location" varchar,
	"nfs_server" boolean DEFAULT false,
	"last_heartbeat" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ssh_access_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"allowed_ips" jsonb DEFAULT '[]'::jsonb,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ssh_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" varchar NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "app_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar NOT NULL,
	"name" varchar NOT NULL,
	"description" text DEFAULT '',
	"icon_url" varchar,
	"category" varchar DEFAULT 'other',
	"compose_template" text NOT NULL,
	"variables" jsonb DEFAULT '[]'::jsonb,
	"is_builtin" boolean DEFAULT false,
	"account_id" uuid,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "app_templates_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" varchar NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "platform_settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "node_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"node_id" uuid NOT NULL,
	"hostname" varchar NOT NULL,
	"cpu_count" integer NOT NULL,
	"mem_total" bigint NOT NULL,
	"mem_used" bigint NOT NULL,
	"mem_free" bigint NOT NULL,
	"container_count" integer NOT NULL,
	"recorded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"user_id" uuid,
	"type" varchar NOT NULL,
	"title" varchar NOT NULL,
	"message" varchar NOT NULL,
	"resource_type" varchar,
	"resource_id" uuid,
	"read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backup_schedules" ADD CONSTRAINT "backup_schedules_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backups" ADD CONSTRAINT "backups_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_billing_overrides" ADD CONSTRAINT "account_billing_overrides_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resource_limits" ADD CONSTRAINT "resource_limits_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_billing_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."billing_plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_records" ADD CONSTRAINT "dns_records_zone_id_dns_zones_id_fk" FOREIGN KEY ("zone_id") REFERENCES "public"."dns_zones"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dns_zones" ADD CONSTRAINT "dns_zones_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_registrars" ADD CONSTRAINT "domain_registrars_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_registrations" ADD CONSTRAINT "domain_registrations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "domain_registrations" ADD CONSTRAINT "domain_registrations_registrar_id_domain_registrars_id_fk" FOREIGN KEY ("registrar_id") REFERENCES "public"."domain_registrars"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_log" ADD CONSTRAINT "email_log_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_providers" ADD CONSTRAINT "oauth_providers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_accounts" ADD CONSTRAINT "user_accounts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_access_rules" ADD CONSTRAINT "ssh_access_rules_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ssh_keys" ADD CONSTRAINT "ssh_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_templates" ADD CONSTRAINT "app_templates_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "node_metrics" ADD CONSTRAINT "node_metrics_node_id_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."nodes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "oauth_provider_user_idx" ON "oauth_providers" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_accounts_user_account_idx" ON "user_accounts" USING btree ("user_id","account_id");