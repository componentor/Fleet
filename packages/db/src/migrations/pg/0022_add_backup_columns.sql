-- Add incremental backup columns to backups table
ALTER TABLE "backups" ADD COLUMN "parent_id" uuid;
ALTER TABLE "backups" ADD COLUMN "level" integer DEFAULT 0;
ALTER TABLE "backups" ADD COLUMN "cluster_id" uuid;
CREATE INDEX IF NOT EXISTS "idx_backups_parent_id" ON "backups" ("parent_id");

-- Add cluster_id to backup_schedules
ALTER TABLE "backup_schedules" ADD COLUMN "cluster_id" uuid;

-- Add backup quota and cluster override to resource_limits
ALTER TABLE "resource_limits" ADD COLUMN "max_container_disk_mb" integer;
ALTER TABLE "resource_limits" ADD COLUMN "max_backup_storage_gb" integer;
ALTER TABLE "resource_limits" ADD COLUMN "backup_cluster_id" uuid;
