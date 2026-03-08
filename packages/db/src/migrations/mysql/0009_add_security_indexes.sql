CREATE INDEX `idx_services_deleted_at` ON `services` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_accounts_deleted_at` ON `accounts` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_accounts_scheduled_deletion` ON `accounts` (`scheduled_deletion_at`);--> statement-breakpoint
CREATE INDEX `idx_nodes_last_heartbeat` ON `nodes` (`last_heartbeat`);--> statement-breakpoint
CREATE INDEX `idx_subscriptions_past_due_since` ON `subscriptions` (`past_due_since`);--> statement-breakpoint
CREATE INDEX `idx_storage_nodes_last_health_check` ON `storage_nodes` (`last_health_check`);
