ALTER TABLE "billing_config" ADD COLUMN IF NOT EXISTS "domain_max_years" integer DEFAULT 10;
