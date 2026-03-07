ALTER TABLE "billing_config" ADD COLUMN "purge_enabled" boolean DEFAULT true;
--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN "purge_retention_days" integer DEFAULT 30;
