ALTER TABLE `service_analytics` ADD COLUMN `avg_response_time_ms` bigint NOT NULL DEFAULT 0;
ALTER TABLE `service_analytics` ADD COLUMN `p95_response_time_ms` bigint NOT NULL DEFAULT 0;
ALTER TABLE `visitor_analytics` ADD COLUMN `countries` json NOT NULL DEFAULT (CAST('{}' AS JSON));
