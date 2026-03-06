-- Add discrete status columns
ALTER TABLE `service_analytics` ADD COLUMN `requests_2xx` bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `service_analytics` ADD COLUMN `requests_3xx` bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `service_analytics` ADD COLUMN `requests_4xx` bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `service_analytics` ADD COLUMN `requests_5xx` bigint NOT NULL DEFAULT 0;--> statement-breakpoint

-- Backfill from JSON
UPDATE `service_analytics` SET
  `requests_2xx` = COALESCE(JSON_EXTRACT(`requests_by_status`, '$."2xx"'), 0),
  `requests_3xx` = COALESCE(JSON_EXTRACT(`requests_by_status`, '$."3xx"'), 0),
  `requests_4xx` = COALESCE(JSON_EXTRACT(`requests_by_status`, '$."4xx"'), 0),
  `requests_5xx` = COALESCE(JSON_EXTRACT(`requests_by_status`, '$."5xx"'), 0)
WHERE `requests_by_status` IS NOT NULL AND `requests_by_status` != '{}';--> statement-breakpoint

-- Drop old JSON column
ALTER TABLE `service_analytics` DROP COLUMN `requests_by_status`;--> statement-breakpoint

-- New indexes for purge and downsampling
CREATE INDEX `idx_service_analytics_recorded_at` ON `service_analytics` (`recorded_at`);--> statement-breakpoint
CREATE INDEX `idx_service_analytics_period_recorded` ON `service_analytics` (`period`, `recorded_at`);
