-- Add discrete status columns to replace JSONB
ALTER TABLE "service_analytics" ADD COLUMN IF NOT EXISTS "requests_2xx" bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "service_analytics" ADD COLUMN IF NOT EXISTS "requests_3xx" bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "service_analytics" ADD COLUMN IF NOT EXISTS "requests_4xx" bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "service_analytics" ADD COLUMN IF NOT EXISTS "requests_5xx" bigint NOT NULL DEFAULT 0;
--> statement-breakpoint

-- Backfill from JSONB
UPDATE "service_analytics" SET
  "requests_2xx" = COALESCE(("requests_by_status"->>'2xx')::bigint, 0),
  "requests_3xx" = COALESCE(("requests_by_status"->>'3xx')::bigint, 0),
  "requests_4xx" = COALESCE(("requests_by_status"->>'4xx')::bigint, 0),
  "requests_5xx" = COALESCE(("requests_by_status"->>'5xx')::bigint, 0)
WHERE "requests_by_status" IS NOT NULL AND "requests_by_status"::text != '{}';
--> statement-breakpoint

-- Drop old JSONB column
ALTER TABLE "service_analytics" DROP COLUMN IF EXISTS "requests_by_status";
--> statement-breakpoint

-- New indexes for purge and downsampling
CREATE INDEX IF NOT EXISTS "idx_service_analytics_recorded_at" ON "service_analytics" ("recorded_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_service_analytics_period_recorded" ON "service_analytics" ("period", "recorded_at");
