-- Add total resource pool limits to resource_limits table
-- These define the total CPU/memory budget an account can allocate across all services
ALTER TABLE "resource_limits" ADD COLUMN IF NOT EXISTS "max_total_cpu_cores" integer;--> statement-breakpoint
ALTER TABLE "resource_limits" ADD COLUMN IF NOT EXISTS "max_total_memory_mb" integer;
