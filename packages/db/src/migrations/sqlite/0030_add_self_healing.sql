CREATE TABLE IF NOT EXISTS "self_healing_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"base_branch" text,
	"working_branch" text,
	"pr_url" text,
	"pr_number" integer,
	"commit_sha" text,
	"release_tag" text,
	"ci_status" text,
	"docker_service_id" text,
	"container_id" text,
	"log" text DEFAULT '',
	"options" text DEFAULT '{}' NOT NULL,
	"error" text,
	"created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
	"started_at" integer,
	"completed_at" integer,
	"created_at" integer DEFAULT (unixepoch()),
	"updated_at" integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_self_healing_jobs_status" ON "self_healing_jobs" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_self_healing_jobs_created_by" ON "self_healing_jobs" ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_self_healing_jobs_created_at" ON "self_healing_jobs" ("created_at");
