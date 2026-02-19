ALTER TABLE "resource_limits" ADD COLUMN "max_container_disk_mb" integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storage_clusters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar DEFAULT 'local' NOT NULL,
	"object_provider" varchar DEFAULT 'local' NOT NULL,
	"status" varchar DEFAULT 'inactive' NOT NULL,
	"replication_factor" integer DEFAULT 3,
	"config" jsonb DEFAULT '{}'::jsonb,
	"object_config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storage_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cluster_id" uuid REFERENCES "storage_clusters"("id"),
	"node_id" uuid REFERENCES "nodes"("id"),
	"hostname" varchar NOT NULL,
	"ip_address" varchar NOT NULL,
	"role" varchar DEFAULT 'storage' NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"storage_path_root" varchar DEFAULT '/srv/fleet-storage',
	"capacity_gb" integer,
	"used_gb" integer DEFAULT 0,
	"last_health_check" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storage_nodes_cluster_idx" ON "storage_nodes" ("cluster_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storage_volumes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL REFERENCES "accounts"("id"),
	"name" varchar NOT NULL,
	"display_name" varchar,
	"size_gb" integer NOT NULL,
	"used_gb" integer DEFAULT 0,
	"provider" varchar DEFAULT 'local' NOT NULL,
	"provider_volume_id" varchar,
	"mount_path" varchar,
	"replica_count" integer DEFAULT 1,
	"status" varchar DEFAULT 'creating' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "storage_volumes_account_idx" ON "storage_volumes" ("account_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "storage_migrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_provider" varchar NOT NULL,
	"to_provider" varchar NOT NULL,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0,
	"total_bytes" bigint,
	"migrated_bytes" bigint DEFAULT 0,
	"current_item" varchar,
	"log" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
