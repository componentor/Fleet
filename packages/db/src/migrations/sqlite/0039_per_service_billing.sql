-- Create stacks table
CREATE TABLE IF NOT EXISTS "stacks" (
  "id" text PRIMARY KEY,
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "name" text,
  "template_slug" text,
  "status" text DEFAULT 'active',
  "created_at" integer DEFAULT (unixepoch()),
  "updated_at" integer DEFAULT (unixepoch()),
  "deleted_at" integer
);
CREATE INDEX IF NOT EXISTS "idx_stacks_account_id" ON "stacks" ("account_id");
CREATE INDEX IF NOT EXISTS "idx_stacks_deleted_at" ON "stacks" ("deleted_at");

-- Billing plans: add scope and volume_included_gb columns
ALTER TABLE "billing_plans" ADD COLUMN "scope" text DEFAULT 'service';
ALTER TABLE "billing_plans" ADD COLUMN "volume_included_gb" integer DEFAULT 0;

-- Subscriptions: add service/stack/payment contact columns
ALTER TABLE "subscriptions" ADD COLUMN "service_id" text;
ALTER TABLE "subscriptions" ADD COLUMN "stack_id" text REFERENCES "stacks"("id") ON DELETE SET NULL;
ALTER TABLE "subscriptions" ADD COLUMN "payment_contact_name" text;
ALTER TABLE "subscriptions" ADD COLUMN "payment_contact_email" text;
CREATE INDEX IF NOT EXISTS "idx_subscriptions_service_id" ON "subscriptions" ("service_id");
CREATE INDEX IF NOT EXISTS "idx_subscriptions_stack_id" ON "subscriptions" ("stack_id");

-- Usage records: add service/stack columns
ALTER TABLE "usage_records" ADD COLUMN "service_id" text;
ALTER TABLE "usage_records" ADD COLUMN "stack_id" text;
CREATE INDEX IF NOT EXISTS "idx_usage_records_service_id" ON "usage_records" ("service_id");
CREATE INDEX IF NOT EXISTS "idx_usage_records_stack_id" ON "usage_records" ("stack_id");

-- Storage volumes: add service/stack/unbound columns
ALTER TABLE "storage_volumes" ADD COLUMN "service_id" text;
ALTER TABLE "storage_volumes" ADD COLUMN "stack_id" text;
ALTER TABLE "storage_volumes" ADD COLUMN "is_unbound" integer DEFAULT 0;
CREATE INDEX IF NOT EXISTS "idx_storage_volumes_service_id" ON "storage_volumes" ("service_id");
CREATE INDEX IF NOT EXISTS "idx_storage_volumes_stack_id" ON "storage_volumes" ("stack_id");

-- Services: add plan_id
ALTER TABLE "services" ADD COLUMN "plan_id" text REFERENCES "billing_plans"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_services_plan_id" ON "services" ("plan_id");
