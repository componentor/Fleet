ALTER TABLE "subscriptions" ADD COLUMN "billed_by_account_id" text REFERENCES "accounts"("id") ON DELETE SET NULL;
