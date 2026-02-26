ALTER TABLE "subscriptions" ADD COLUMN "billed_by_account_id" uuid REFERENCES "accounts"("id") ON DELETE SET NULL;
