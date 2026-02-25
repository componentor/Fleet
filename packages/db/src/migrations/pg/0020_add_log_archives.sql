-- Track archived audit_log and error_log entries as compressed .tar.gz files
CREATE TABLE IF NOT EXISTS "log_archives" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "log_type" varchar NOT NULL,
  "account_id" uuid,
  "date_from" timestamp NOT NULL,
  "date_to" timestamp NOT NULL,
  "record_count" integer NOT NULL DEFAULT 0,
  "size_bytes" bigint DEFAULT 0,
  "file_path" varchar NOT NULL,
  "filename" varchar NOT NULL,
  "status" varchar DEFAULT 'completed',
  "created_at" timestamp DEFAULT now(),
  "expires_at" timestamp
);

CREATE INDEX IF NOT EXISTS "idx_log_archives_log_type" ON "log_archives" ("log_type");
CREATE INDEX IF NOT EXISTS "idx_log_archives_account_id" ON "log_archives" ("account_id");
CREATE INDEX IF NOT EXISTS "idx_log_archives_created_at" ON "log_archives" ("created_at");
CREATE INDEX IF NOT EXISTS "idx_log_archives_expires_at" ON "log_archives" ("expires_at");
