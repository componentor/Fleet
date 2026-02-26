DROP INDEX IF EXISTS "idx_registry_credentials_account_id";
ALTER TABLE "registry_credentials" DROP COLUMN IF EXISTS "account_id";
