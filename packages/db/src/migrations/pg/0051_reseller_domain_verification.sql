ALTER TABLE "reseller_accounts" ADD COLUMN IF NOT EXISTS "custom_domain_verified" boolean DEFAULT false;
ALTER TABLE "reseller_accounts" ADD COLUMN IF NOT EXISTS "custom_domain_token" varchar;
