ALTER TABLE "service_analytics" ADD COLUMN "io_read_bytes" integer NOT NULL DEFAULT 0;
ALTER TABLE "service_analytics" ADD COLUMN "io_write_bytes" integer NOT NULL DEFAULT 0;
