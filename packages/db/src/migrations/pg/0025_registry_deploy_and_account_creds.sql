ALTER TABLE "registry_credentials" ADD COLUMN IF NOT EXISTS "account_id" uuid REFERENCES "accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_registry_credentials_account_id" ON "registry_credentials" ("account_id");--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "registry_poll_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "registry_poll_interval" integer DEFAULT 300;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "registry_poll_digest" varchar;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "registry_webhook_secret" varchar;
