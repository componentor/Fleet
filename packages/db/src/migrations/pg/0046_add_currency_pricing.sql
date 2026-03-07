CREATE TABLE IF NOT EXISTS "billing_plan_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "plan_id" uuid NOT NULL REFERENCES "billing_plans"("id") ON DELETE CASCADE,
  "currency" varchar(3) NOT NULL,
  "price_cents" integer NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_billing_plan_prices_plan_currency" ON "billing_plan_prices" ("plan_id", "currency");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "domain_tld_currency_prices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tld_pricing_id" uuid NOT NULL REFERENCES "domain_tld_pricing"("id") ON DELETE CASCADE,
  "currency" varchar(3) NOT NULL,
  "sell_registration_price" integer NOT NULL,
  "sell_renewal_price" integer NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "idx_tld_currency_prices_tld_currency" ON "domain_tld_currency_prices" ("tld_pricing_id", "currency");
