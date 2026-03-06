ALTER TABLE "billing_plan_prices" ADD COLUMN "cycle" text NOT NULL DEFAULT 'monthly';
DROP INDEX IF EXISTS "idx_billing_plan_prices_plan_currency";
CREATE UNIQUE INDEX "idx_billing_plan_prices_plan_currency_cycle" ON "billing_plan_prices" ("plan_id", "currency", "cycle");
