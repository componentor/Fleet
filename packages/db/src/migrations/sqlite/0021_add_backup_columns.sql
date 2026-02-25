-- Add incremental backup columns to backups table
ALTER TABLE "backups" ADD COLUMN "parent_id" text;
--> statement-breakpoint
ALTER TABLE "backups" ADD COLUMN "level" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "backups" ADD COLUMN "cluster_id" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_backups_parent_id" ON "backups" ("parent_id");
--> statement-breakpoint
-- Add cluster_id to backup_schedules
ALTER TABLE "backup_schedules" ADD COLUMN "cluster_id" text;
--> statement-breakpoint
-- Add backup quota and cluster override to resource_limits
-- max_container_disk_mb already added in 0005_add_storage_tables
ALTER TABLE "resource_limits" ADD COLUMN "max_backup_storage_gb" integer;
--> statement-breakpoint
ALTER TABLE "resource_limits" ADD COLUMN "backup_cluster_id" text;
