ALTER TABLE "ssh_keys" ADD COLUMN "node_access" integer DEFAULT 0;
--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN "ssh_allowed_ips" text;
