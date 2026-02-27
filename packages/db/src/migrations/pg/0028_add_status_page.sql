CREATE TABLE "status_posts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "icon" varchar NOT NULL DEFAULT 'info',
  "severity" varchar NOT NULL DEFAULT 'info',
  "status" varchar NOT NULL DEFAULT 'draft',
  "affected_services" jsonb DEFAULT '[]'::jsonb,
  "published_at" timestamp,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_status_posts_status" ON "status_posts" ("status");
--> statement-breakpoint
CREATE INDEX "idx_status_posts_published_at" ON "status_posts" ("published_at");
--> statement-breakpoint
CREATE TABLE "status_post_translations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "post_id" uuid NOT NULL REFERENCES "status_posts"("id") ON DELETE CASCADE,
  "locale" varchar NOT NULL,
  "title" varchar NOT NULL,
  "body" text NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_status_post_translations_post_locale" ON "status_post_translations" ("post_id", "locale");
--> statement-breakpoint
CREATE TABLE "uptime_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "service" varchar NOT NULL,
  "status" varchar NOT NULL,
  "response_ms" integer,
  "recorded_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_uptime_snapshots_service_recorded" ON "uptime_snapshots" ("service", "recorded_at");
