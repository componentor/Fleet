ALTER TABLE "account_billing_overrides" ADD COLUMN "max_free_services" integer;
--> statement-breakpoint
ALTER TABLE "account_billing_overrides" ADD COLUMN "free_tier_cpu_limit" integer;
--> statement-breakpoint
ALTER TABLE "account_billing_overrides" ADD COLUMN "free_tier_memory_limit" integer;
--> statement-breakpoint
ALTER TABLE "account_billing_overrides" ADD COLUMN "free_tier_container_limit" integer;
--> statement-breakpoint
ALTER TABLE "account_billing_overrides" ADD COLUMN "free_tier_storage_limit" integer;
