ALTER TABLE "node_metrics" ADD COLUMN "disk_total" bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "node_metrics" ADD COLUMN "disk_used" bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "node_metrics" ADD COLUMN "disk_free" bigint NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "node_metrics" ADD COLUMN "disk_type" varchar NOT NULL DEFAULT 'unknown';
