ALTER TABLE "account_billing_overrides" ADD COLUMN "boost_cpu_limit" integer;
--> statement-breakpoint
ALTER TABLE "account_billing_overrides" ADD COLUMN "boost_memory_limit" integer;
--> statement-breakpoint
ALTER TABLE "account_billing_overrides" ADD COLUMN "boost_container_limit" integer;
--> statement-breakpoint
ALTER TABLE "account_billing_overrides" ADD COLUMN "boost_storage_limit" integer;
