-- Create tables that were missing from the original MySQL migration chain.
-- These tables exist in other dialects but were accidentally omitted from MySQL.

CREATE TABLE IF NOT EXISTS `error_log` (
	`id` varchar(36) NOT NULL,
	`level` varchar(50) NOT NULL,
	`message` text NOT NULL,
	`stack` text,
	`method` varchar(10),
	`path` varchar(500),
	`status_code` int,
	`user_id` varchar(36),
	`ip` varchar(45),
	`user_agent` text,
	`metadata` json,
	`resolved` boolean DEFAULT false,
	`status` varchar(50) DEFAULT 'open',
	`self_healing_job_id` varchar(36),
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `error_log_id` PRIMARY KEY(`id`),
	INDEX `idx_error_log_created_at` (`created_at`),
	INDEX `idx_error_log_level` (`level`),
	INDEX `idx_error_log_resolved` (`resolved`),
	INDEX `idx_error_log_status` (`status`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `webhook_events` (
	`id` varchar(36) NOT NULL,
	`stripe_event_id` varchar(255) NOT NULL,
	`event_type` varchar(255) NOT NULL,
	`processed_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	`payload` json,
	`created_at` timestamp DEFAULT CURRENT_TIMESTAMP,
	CONSTRAINT `webhook_events_id` PRIMARY KEY(`id`),
	CONSTRAINT `webhook_events_stripe_event_id_unique` UNIQUE(`stripe_event_id`)
);
