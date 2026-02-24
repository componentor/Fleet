-- Add total resource pool limits to resource_limits table
ALTER TABLE `resource_limits` ADD COLUMN `max_total_cpu_cores` int;--> statement-breakpoint
ALTER TABLE `resource_limits` ADD COLUMN `max_total_memory_mb` int;
