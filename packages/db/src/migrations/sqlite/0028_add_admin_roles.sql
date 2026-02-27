CREATE TABLE IF NOT EXISTS "admin_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permissions" text DEFAULT '{}' NOT NULL,
	"is_builtin" integer DEFAULT 0,
	"created_at" integer DEFAULT (unixepoch()),
	"updated_at" integer DEFAULT (unixepoch())
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_roles_name_idx" ON "admin_roles" ("name");
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "admin_role_id" text REFERENCES "admin_roles"("id") ON DELETE SET NULL;
