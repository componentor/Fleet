ALTER TABLE `services` ADD COLUMN `git_url` varchar(500);
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `git_branch` varchar(255);
--> statement-breakpoint
ALTER TABLE `services` ADD COLUMN `git_token` varchar(500);
