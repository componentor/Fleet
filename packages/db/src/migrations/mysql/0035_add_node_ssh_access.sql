ALTER TABLE `ssh_keys` ADD COLUMN `node_access` boolean DEFAULT false;
--> statement-breakpoint
ALTER TABLE `nodes` ADD COLUMN `ssh_allowed_ips` json;
