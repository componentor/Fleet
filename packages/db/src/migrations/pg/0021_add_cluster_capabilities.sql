-- Add allowServices and allowBackups capability flags to storage_clusters
ALTER TABLE "storage_clusters" ADD COLUMN IF NOT EXISTS "allow_services" boolean DEFAULT true NOT NULL;
ALTER TABLE "storage_clusters" ADD COLUMN IF NOT EXISTS "allow_backups" boolean DEFAULT true NOT NULL;
