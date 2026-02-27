CREATE TABLE "status_posts" (
  "id" text PRIMARY KEY,
  "icon" text NOT NULL DEFAULT 'info',
  "severity" text NOT NULL DEFAULT 'info',
  "status" text NOT NULL DEFAULT 'draft',
  "affected_services" text DEFAULT '[]',
  "published_at" integer,
  "created_by" text REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" integer DEFAULT (unixepoch()),
  "updated_at" integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX "idx_status_posts_status" ON "status_posts" ("status");
--> statement-breakpoint
CREATE INDEX "idx_status_posts_published_at" ON "status_posts" ("published_at");
--> statement-breakpoint
CREATE TABLE "status_post_translations" (
  "id" text PRIMARY KEY,
  "post_id" text NOT NULL REFERENCES "status_posts"("id") ON DELETE CASCADE,
  "locale" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "created_at" integer DEFAULT (unixepoch()),
  "updated_at" integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_status_post_translations_post_locale" ON "status_post_translations" ("post_id", "locale");
--> statement-breakpoint
CREATE TABLE "uptime_snapshots" (
  "id" text PRIMARY KEY,
  "service" text NOT NULL,
  "status" text NOT NULL,
  "response_ms" integer,
  "recorded_at" integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX "idx_uptime_snapshots_service_recorded" ON "uptime_snapshots" ("service", "recorded_at");
