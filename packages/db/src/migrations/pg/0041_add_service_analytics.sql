CREATE TABLE IF NOT EXISTS "service_analytics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "requests" bigint NOT NULL DEFAULT 0,
  "requests_by_status" jsonb NOT NULL DEFAULT '{}',
  "bytes_in" bigint NOT NULL DEFAULT 0,
  "bytes_out" bigint NOT NULL DEFAULT 0,
  "period" varchar(10) NOT NULL DEFAULT '5m',
  "recorded_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_service_analytics_service_recorded" ON "service_analytics" ("service_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "idx_service_analytics_account_recorded" ON "service_analytics" ("account_id", "recorded_at");
