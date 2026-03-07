ALTER TABLE "billing_plans" ADD COLUMN "name_translations" text DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE "billing_plans" ADD COLUMN "description_translations" text DEFAULT '{}';
