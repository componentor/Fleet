ALTER TABLE "services" ADD COLUMN "restart_condition" varchar DEFAULT 'on-failure';
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "restart_max_attempts" integer DEFAULT 3;
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "restart_delay" varchar DEFAULT '10s';
