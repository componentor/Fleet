-- Re-add account_id to registry_credentials (nullable for platform-wide + account-scoped)
ALTER TABLE "registry_credentials" ADD COLUMN IF NOT EXISTS "account_id" uuid REFERENCES "accounts"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_registry_credentials_account_id" ON "registry_credentials" ("account_id");

-- Add registry polling columns to services
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "registry_poll_enabled" boolean DEFAULT false;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "registry_poll_interval" integer DEFAULT 300;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "registry_poll_digest" varchar;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "registry_webhook_secret" varchar;
