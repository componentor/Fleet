ALTER TABLE "reseller_accounts" ADD COLUMN "custom_domain_verified" integer DEFAULT 0;
ALTER TABLE "reseller_accounts" ADD COLUMN "custom_domain_token" text;
