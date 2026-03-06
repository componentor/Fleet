CREATE TABLE IF NOT EXISTS "service_analytics" (
  "id" text PRIMARY KEY,
  "service_id" text NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "requests" integer NOT NULL DEFAULT 0,
  "requests_by_status" text NOT NULL DEFAULT '{}',
  "bytes_in" integer NOT NULL DEFAULT 0,
  "bytes_out" integer NOT NULL DEFAULT 0,
  "period" text NOT NULL DEFAULT '5m',
  "recorded_at" integer NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS "idx_service_analytics_service_recorded" ON "service_analytics" ("service_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "idx_service_analytics_account_recorded" ON "service_analytics" ("account_id", "recorded_at");
