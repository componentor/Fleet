ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "git_url" varchar;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "git_branch" varchar;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "git_token" varchar;
