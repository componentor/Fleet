ALTER TABLE "error_log" ADD COLUMN "status" text DEFAULT 'open';
--> statement-breakpoint
ALTER TABLE "error_log" ADD COLUMN "self_healing_job_id" text;
--> statement-breakpoint
UPDATE "error_log" SET "status" = 'resolved' WHERE "resolved" = 1 AND ("status" IS NULL OR "status" = 'open');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_error_log_status" ON "error_log" ("status");
