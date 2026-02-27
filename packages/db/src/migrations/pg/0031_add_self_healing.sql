CREATE TABLE IF NOT EXISTS "self_healing_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt" text NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"base_branch" varchar,
	"working_branch" varchar,
	"pr_url" varchar,
	"pr_number" integer,
	"commit_sha" varchar,
	"release_tag" varchar,
	"ci_status" varchar,
	"docker_service_id" varchar,
	"container_id" varchar,
	"log" text DEFAULT '',
	"options" jsonb DEFAULT '{}' NOT NULL,
	"error" text,
	"created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_self_healing_jobs_status" ON "self_healing_jobs" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_self_healing_jobs_created_by" ON "self_healing_jobs" USING btree ("created_by");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_self_healing_jobs_created_at" ON "self_healing_jobs" USING btree ("created_at");
