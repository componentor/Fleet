CREATE TABLE "registry_credentials_new" (
  "id" text PRIMARY KEY NOT NULL,
  "registry" text NOT NULL,
  "username" text NOT NULL,
  "password" text NOT NULL,
  "created_at" integer DEFAULT (unixepoch()),
  "updated_at" integer DEFAULT (unixepoch())
);--> statement-breakpoint
INSERT INTO "registry_credentials_new" ("id", "registry", "username", "password", "created_at", "updated_at")
  SELECT "id", "registry", "username", "password", "created_at", "updated_at" FROM "registry_credentials";--> statement-breakpoint
DROP TABLE "registry_credentials";--> statement-breakpoint
ALTER TABLE "registry_credentials_new" RENAME TO "registry_credentials";
