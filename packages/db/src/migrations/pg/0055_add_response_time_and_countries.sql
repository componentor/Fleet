ALTER TABLE "service_analytics" ADD COLUMN IF NOT EXISTS "avg_response_time_ms" bigint NOT NULL DEFAULT 0;
ALTER TABLE "service_analytics" ADD COLUMN IF NOT EXISTS "p95_response_time_ms" bigint NOT NULL DEFAULT 0;
ALTER TABLE "visitor_analytics" ADD COLUMN IF NOT EXISTS "countries" jsonb NOT NULL DEFAULT '{}';
