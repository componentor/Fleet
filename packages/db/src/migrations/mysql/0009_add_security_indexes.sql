CREATE INDEX `idx_services_deleted_at` ON `services` (`deleted_at`);
CREATE INDEX `idx_accounts_deleted_at` ON `accounts` (`deleted_at`);
CREATE INDEX `idx_accounts_scheduled_deletion` ON `accounts` (`scheduled_deletion_at`);
CREATE INDEX `idx_nodes_last_heartbeat` ON `nodes` (`last_heartbeat`);
CREATE INDEX `idx_subscriptions_past_due_since` ON `subscriptions` (`past_due_since`);
CREATE INDEX `idx_storage_nodes_last_health_check` ON `storage_nodes` (`last_health_check`);
CREATE INDEX `idx_storage_volumes_deleted_at` ON `storage_volumes` (`deleted_at`);
