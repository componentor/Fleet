ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "currency" varchar(3) DEFAULT 'USD';
