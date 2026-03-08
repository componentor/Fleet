CREATE TABLE IF NOT EXISTS `service_analytics` (
  `id` varchar(36) PRIMARY KEY,
  `service_id` varchar(36) NOT NULL,
  `account_id` varchar(36) NOT NULL,
  `requests` bigint NOT NULL DEFAULT 0,
  `requests_by_status` json NOT NULL,
  `bytes_in` bigint NOT NULL DEFAULT 0,
  `bytes_out` bigint NOT NULL DEFAULT 0,
  `period` varchar(10) NOT NULL DEFAULT '5m',
  `recorded_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);

--> statement-breakpoint
CREATE INDEX `idx_service_analytics_service_recorded` ON `service_analytics` (`service_id`, `recorded_at`);
--> statement-breakpoint
CREATE INDEX `idx_service_analytics_account_recorded` ON `service_analytics` (`account_id`, `recorded_at`);
