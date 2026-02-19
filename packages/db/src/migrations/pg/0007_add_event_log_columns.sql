ALTER TABLE "audit_log" ADD COLUMN "event_type" varchar;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "description" varchar;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "resource_name" varchar;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "actor_email" varchar;
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "source" varchar DEFAULT 'user';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_audit_log_event_type" ON "audit_log" ("event_type");
