-- Add scheduled deletion support for accounts
ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "scheduled_deletion_at" timestamp;
--> statement-breakpoint
-- Add stack grouping for services
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "stack_id" varchar;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_services_stack_id" ON "services" ("stack_id");
