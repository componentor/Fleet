CREATE TABLE IF NOT EXISTS "shared_domains" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "domain" varchar(255) NOT NULL,
  "enabled" boolean DEFAULT true,
  "pricing_type" varchar(20) NOT NULL DEFAULT 'free',
  "price" integer NOT NULL DEFAULT 0,
  "currency" varchar(3) NOT NULL DEFAULT 'USD',
  "max_per_account" integer NOT NULL DEFAULT 0,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "shared_domains_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subdomain_claims" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "shared_domain_id" uuid NOT NULL REFERENCES "shared_domains"("id") ON DELETE CASCADE,
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "subdomain" varchar(63) NOT NULL,
  "service_id" uuid REFERENCES "services"("id") ON DELETE SET NULL,
  "status" varchar(20) NOT NULL DEFAULT 'active',
  "stripe_payment_id" varchar(255),
  "stripe_subscription_id" varchar(255),
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "subdomain_claims_unique" UNIQUE("shared_domain_id", "subdomain")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subdomain_claims_shared_domain_id" ON "subdomain_claims" ("shared_domain_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subdomain_claims_account_id" ON "subdomain_claims" ("account_id");
