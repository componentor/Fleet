ALTER TABLE "billing_config" ADD COLUMN "allow_downgrade" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN "deletion_billing_policy" text NOT NULL DEFAULT 'end_of_period';
