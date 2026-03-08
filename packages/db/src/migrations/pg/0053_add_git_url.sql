ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "git_url" varchar;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "git_branch" varchar;
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "git_token" varchar;
