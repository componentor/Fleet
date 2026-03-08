CREATE TABLE IF NOT EXISTS "visitor_analytics" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "service_id" uuid NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "unique_visitors" bigint NOT NULL DEFAULT 0,
  "page_views" bigint NOT NULL DEFAULT 0,
  "top_paths" jsonb NOT NULL DEFAULT '[]',
  "top_referrers" jsonb NOT NULL DEFAULT '[]',
  "browsers" jsonb NOT NULL DEFAULT '{}',
  "devices" jsonb NOT NULL DEFAULT '{}',
  "period" varchar(10) NOT NULL DEFAULT '5m',
  "recorded_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_visitor_analytics_service_recorded" ON "visitor_analytics" ("service_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "idx_visitor_analytics_account_recorded" ON "visitor_analytics" ("account_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "idx_visitor_analytics_recorded_at" ON "visitor_analytics" ("recorded_at");
