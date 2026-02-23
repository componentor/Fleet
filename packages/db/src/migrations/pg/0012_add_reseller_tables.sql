CREATE TABLE IF NOT EXISTS "reseller_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "enabled" boolean DEFAULT false,
  "approval_mode" varchar DEFAULT 'manual',
  "allow_sub_account_reselling" boolean DEFAULT false,
  "default_discount_type" varchar DEFAULT 'percentage',
  "default_discount_percent" integer DEFAULT 0,
  "default_discount_fixed" integer DEFAULT 0,
  "updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reseller_accounts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "status" varchar DEFAULT 'pending',
  "stripe_connect_id" varchar,
  "connect_onboarded" boolean DEFAULT false,
  "discount_type" varchar,
  "discount_percent" integer,
  "discount_fixed" integer,
  "markup_type" varchar DEFAULT 'percentage',
  "markup_percent" integer DEFAULT 0,
  "markup_fixed" integer DEFAULT 0,
  "can_sub_account_resell" boolean DEFAULT false,
  "signup_slug" varchar UNIQUE,
  "custom_domain" varchar,
  "brand_name" varchar,
  "brand_logo_url" varchar,
  "brand_primary_color" varchar,
  "brand_description" text,
  "approved_at" timestamp,
  "approved_by" uuid,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "reseller_accounts_account_id_unique" UNIQUE("account_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reseller_applications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "account_id" uuid NOT NULL REFERENCES "accounts"("id") ON DELETE CASCADE,
  "message" text,
  "status" varchar DEFAULT 'pending',
  "reviewed_by" uuid,
  "reviewed_at" timestamp,
  "review_note" text,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reseller_accounts_status" ON "reseller_accounts" ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reseller_applications_account_id" ON "reseller_applications" ("account_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_reseller_applications_status" ON "reseller_applications" ("status");
