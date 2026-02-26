ALTER TABLE "registry_credentials" ADD COLUMN "account_id" text REFERENCES "accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_registry_credentials_account_id" ON "registry_credentials" ("account_id");--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "registry_poll_enabled" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "registry_poll_interval" integer DEFAULT 300;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "registry_poll_digest" text;--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "registry_webhook_secret" text;
