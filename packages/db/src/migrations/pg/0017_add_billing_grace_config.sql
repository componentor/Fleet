-- Add configurable grace period settings to billing_config
ALTER TABLE "billing_config" ADD COLUMN IF NOT EXISTS "suspension_grace_days" integer DEFAULT 7;
--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN IF NOT EXISTS "deletion_grace_days" integer DEFAULT 14;
--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN IF NOT EXISTS "auto_suspend_enabled" boolean DEFAULT true;
--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN IF NOT EXISTS "auto_delete_enabled" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN IF NOT EXISTS "suspension_warning_days" integer DEFAULT 2;
--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN IF NOT EXISTS "deletion_warning_days" integer DEFAULT 7;
--> statement-breakpoint
ALTER TABLE "billing_config" ADD COLUMN IF NOT EXISTS "volume_deletion_enabled" boolean DEFAULT true;
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "suspended_at" timestamp;
