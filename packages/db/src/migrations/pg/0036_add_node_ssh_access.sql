ALTER TABLE "ssh_keys" ADD COLUMN IF NOT EXISTS "node_access" boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE "nodes" ADD COLUMN IF NOT EXISTS "ssh_allowed_ips" jsonb;
