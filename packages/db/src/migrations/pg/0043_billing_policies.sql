ALTER TABLE "billing_config" ADD COLUMN IF NOT EXISTS "allow_downgrade" boolean NOT NULL DEFAULT true;
--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN IF NOT EXISTS "deletion_billing_policy" varchar NOT NULL DEFAULT 'end_of_period';
