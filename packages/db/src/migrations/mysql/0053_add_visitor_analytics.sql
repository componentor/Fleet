CREATE TABLE IF NOT EXISTS `visitor_analytics` (
  `id` varchar(36) NOT NULL PRIMARY KEY,
  `service_id` varchar(36) NOT NULL,
  `account_id` varchar(36) NOT NULL,
  `unique_visitors` bigint NOT NULL DEFAULT 0,
  `page_views` bigint NOT NULL DEFAULT 0,
  `top_paths` json NOT NULL,
  `top_referrers` json NOT NULL,
  `browsers` json NOT NULL,
  `devices` json NOT NULL,
  `period` varchar(10) NOT NULL DEFAULT '5m',
  `recorded_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE CASCADE,
  FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON DELETE CASCADE
);

CREATE INDEX `idx_visitor_analytics_service_recorded` ON `visitor_analytics` (`service_id`, `recorded_at`);
CREATE INDEX `idx_visitor_analytics_account_recorded` ON `visitor_analytics` (`account_id`, `recorded_at`);
CREATE INDEX `idx_visitor_analytics_recorded_at` ON `visitor_analytics` (`recorded_at`);
