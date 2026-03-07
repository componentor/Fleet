ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "name_translations" jsonb DEFAULT '{}'::jsonb;
--> statement-breakpoint
ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "description_translations" jsonb DEFAULT '{}'::jsonb;
