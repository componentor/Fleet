-- Add separate renewal markup columns to domain_tld_pricing
ALTER TABLE `domain_tld_pricing` ADD COLUMN `renewal_markup_type` varchar(20);
--> statement-breakpoint
ALTER TABLE `domain_tld_pricing` ADD COLUMN `renewal_markup_value` int;
