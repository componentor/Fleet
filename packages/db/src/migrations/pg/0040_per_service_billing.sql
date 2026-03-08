-- Create stacks table
CREATE TABLE IF NOT EXISTS "stacks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "name" varchar,
  "template_slug" varchar,
  "status" varchar DEFAULT 'active',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "deleted_at" timestamp
);
CREATE INDEX IF NOT EXISTS "idx_stacks_account_id" ON "stacks" ("account_id");
CREATE INDEX IF NOT EXISTS "idx_stacks_deleted_at" ON "stacks" ("deleted_at");

-- Billing plans: add scope and volume_included_gb columns
ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "scope" varchar DEFAULT 'service';
ALTER TABLE "billing_plans" ADD COLUMN IF NOT EXISTS "volume_included_gb" integer DEFAULT 0;

-- Subscriptions: add service/stack/payment contact columns
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "service_id" uuid;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "stack_id" uuid REFERENCES "stacks"("id") ON DELETE SET NULL;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "payment_contact_name" varchar;
ALTER TABLE "subscriptions" ADD COLUMN IF NOT EXISTS "payment_contact_email" varchar;
CREATE INDEX IF NOT EXISTS "idx_subscriptions_service_id" ON "subscriptions" ("service_id");
CREATE INDEX IF NOT EXISTS "idx_subscriptions_stack_id" ON "subscriptions" ("stack_id");

-- Usage records: add service/stack columns
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "service_id" uuid;
ALTER TABLE "usage_records" ADD COLUMN IF NOT EXISTS "stack_id" uuid;
CREATE INDEX IF NOT EXISTS "idx_usage_records_service_id" ON "usage_records" ("service_id");
CREATE INDEX IF NOT EXISTS "idx_usage_records_stack_id" ON "usage_records" ("stack_id");

-- Storage volumes: add service/stack/unbound columns
ALTER TABLE "storage_volumes" ADD COLUMN IF NOT EXISTS "service_id" uuid;
ALTER TABLE "storage_volumes" ADD COLUMN IF NOT EXISTS "stack_id" uuid;
ALTER TABLE "storage_volumes" ADD COLUMN IF NOT EXISTS "is_unbound" boolean DEFAULT false;
CREATE INDEX IF NOT EXISTS "idx_storage_volumes_service_id" ON "storage_volumes" ("service_id");
CREATE INDEX IF NOT EXISTS "idx_storage_volumes_stack_id" ON "storage_volumes" ("stack_id");

-- Services: add plan_id
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "plan_id" uuid REFERENCES "billing_plans"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS "idx_services_plan_id" ON "services" ("plan_id");

-- Backfill: Create stack records for existing services with stack_id
INSERT INTO "stacks" ("id", "account_id", "name", "status", "created_at")
SELECT DISTINCT s."stack_id"::uuid, s."account_id", 'Imported Stack', 'active', MIN(s."created_at")
FROM "services" s
WHERE s."stack_id" IS NOT NULL AND s."deleted_at" IS NULL
GROUP BY s."stack_id", s."account_id"
ON CONFLICT DO NOTHING;
