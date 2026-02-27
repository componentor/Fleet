CREATE TABLE IF NOT EXISTS "support_tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"subject" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"account_id" text NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
	"created_by" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"assigned_to" text REFERENCES "users"("id") ON DELETE SET NULL,
	"closed_at" integer,
	"created_at" integer DEFAULT (unixepoch()),
	"updated_at" integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_account_id" ON "support_tickets" ("account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_status" ON "support_tickets" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_assigned_to" ON "support_tickets" ("assigned_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_created_by" ON "support_tickets" ("created_by");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_ticket_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
	"author_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"body" text NOT NULL,
	"is_internal" integer DEFAULT 0,
	"created_at" integer DEFAULT (unixepoch()),
	"updated_at" integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_ticket_messages_ticket_id" ON "support_ticket_messages" ("ticket_id");
