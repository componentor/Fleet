-- Add incremental backup columns to backups table
ALTER TABLE "backups" ADD COLUMN IF NOT EXISTS "parent_id" uuid;
--> statement-breakpoint
ALTER TABLE "backups" ADD COLUMN IF NOT EXISTS "level" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "backups" ADD COLUMN IF NOT EXISTS "cluster_id" uuid;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_backups_parent_id" ON "backups" ("parent_id");
--> statement-breakpoint

-- Add cluster_id to backup_schedules
ALTER TABLE "backup_schedules" ADD COLUMN IF NOT EXISTS "cluster_id" uuid;
--> statement-breakpoint

-- Add backup quota and cluster override to resource_limits
ALTER TABLE "resource_limits" ADD COLUMN IF NOT EXISTS "max_container_disk_mb" integer;
--> statement-breakpoint
ALTER TABLE "resource_limits" ADD COLUMN IF NOT EXISTS "max_backup_storage_gb" integer;
--> statement-breakpoint
ALTER TABLE "resource_limits" ADD COLUMN IF NOT EXISTS "backup_cluster_id" uuid;
