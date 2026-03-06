ALTER TABLE `billing_config` ADD COLUMN `allow_downgrade` boolean NOT NULL DEFAULT true;--> statement-breakpoint
ALTER TABLE `billing_config` ADD COLUMN `deletion_billing_policy` varchar(20) NOT NULL DEFAULT 'end_of_period';
