-- Add discrete status columns (SQLite cannot DROP COLUMN in older versions, old column becomes unused)
ALTER TABLE "service_analytics" ADD COLUMN "requests_2xx" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "service_analytics" ADD COLUMN "requests_3xx" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "service_analytics" ADD COLUMN "requests_4xx" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "service_analytics" ADD COLUMN "requests_5xx" integer NOT NULL DEFAULT 0;--> statement-breakpoint

-- New indexes for purge and downsampling
CREATE INDEX IF NOT EXISTS "idx_service_analytics_recorded_at" ON "service_analytics" ("recorded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_service_analytics_period_recorded" ON "service_analytics" ("period", "recorded_at");
