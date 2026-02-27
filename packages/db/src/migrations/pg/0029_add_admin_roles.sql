CREATE TABLE IF NOT EXISTS "admin_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" varchar(255),
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_builtin" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "admin_roles_name_idx" ON "admin_roles" USING btree ("name");
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "admin_role_id" uuid REFERENCES "admin_roles"("id") ON DELETE SET NULL;
