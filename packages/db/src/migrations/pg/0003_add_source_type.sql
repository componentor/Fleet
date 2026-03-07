ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "source_type" varchar(20);
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "source_path" varchar;
