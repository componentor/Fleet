ALTER TABLE "error_log" ADD COLUMN IF NOT EXISTS "status" varchar DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE "error_log" ADD COLUMN IF NOT EXISTS "self_healing_job_id" uuid;
--> statement-breakpoint
UPDATE "error_log" SET "status" = 'resolved' WHERE "resolved" = true AND ("status" IS NULL OR "status" = 'open');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_error_log_status" ON "error_log" ("status");
