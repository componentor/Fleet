CREATE TABLE IF NOT EXISTS "visitor_analytics" (
  "id" text PRIMARY KEY NOT NULL,
  "service_id" text NOT NULL REFERENCES "services"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "unique_visitors" integer NOT NULL DEFAULT 0,
  "page_views" integer NOT NULL DEFAULT 0,
  "top_paths" text NOT NULL DEFAULT '[]',
  "top_referrers" text NOT NULL DEFAULT '[]',
  "browsers" text NOT NULL DEFAULT '{}',
  "devices" text NOT NULL DEFAULT '{}',
  "period" text NOT NULL DEFAULT '5m',
  "recorded_at" integer NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS "idx_visitor_analytics_service_recorded" ON "visitor_analytics" ("service_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "idx_visitor_analytics_account_recorded" ON "visitor_analytics" ("account_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "idx_visitor_analytics_recorded_at" ON "visitor_analytics" ("recorded_at");
