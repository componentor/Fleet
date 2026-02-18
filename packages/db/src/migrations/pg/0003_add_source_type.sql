ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "source_type" varchar(20);
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "source_path" varchar;
