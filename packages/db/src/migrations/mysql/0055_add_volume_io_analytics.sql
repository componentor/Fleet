ALTER TABLE `service_analytics` ADD COLUMN `io_read_bytes` bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE `service_analytics` ADD COLUMN `io_write_bytes` bigint NOT NULL DEFAULT 0;
