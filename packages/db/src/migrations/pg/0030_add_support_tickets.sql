CREATE TABLE IF NOT EXISTS "support_tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject" varchar(255) NOT NULL,
	"status" varchar DEFAULT 'open' NOT NULL,
	"priority" varchar DEFAULT 'normal' NOT NULL,
	"account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
	"created_by" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"assigned_to" uuid REFERENCES "users"("id") ON DELETE SET NULL,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_account_id" ON "support_tickets" USING btree ("account_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_status" ON "support_tickets" USING btree ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_assigned_to" ON "support_tickets" USING btree ("assigned_to");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_tickets_created_by" ON "support_tickets" USING btree ("created_by");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "support_ticket_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL REFERENCES "support_tickets"("id") ON DELETE CASCADE,
	"author_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
	"body" text NOT NULL,
	"is_internal" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_support_ticket_messages_ticket_id" ON "support_ticket_messages" USING btree ("ticket_id");
