-- Add allowServices and allowBackups capability flags to storage_clusters
ALTER TABLE "storage_clusters" ADD COLUMN "allow_services" integer DEFAULT 1 NOT NULL;
ALTER TABLE "storage_clusters" ADD COLUMN "allow_backups" integer DEFAULT 1 NOT NULL;
