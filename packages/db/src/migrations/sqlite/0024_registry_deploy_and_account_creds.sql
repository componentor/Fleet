-- Re-add account_id to registry_credentials
ALTER TABLE "registry_credentials" ADD COLUMN "account_id" text REFERENCES "accounts"("id") ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS "idx_registry_credentials_account_id" ON "registry_credentials" ("account_id");

-- Add registry polling columns to services
ALTER TABLE "services" ADD COLUMN "registry_poll_enabled" integer DEFAULT 0;
ALTER TABLE "services" ADD COLUMN "registry_poll_interval" integer DEFAULT 300;
ALTER TABLE "services" ADD COLUMN "registry_poll_digest" text;
ALTER TABLE "services" ADD COLUMN "registry_webhook_secret" text;
