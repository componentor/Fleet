CREATE INDEX IF NOT EXISTS "idx_services_deleted_at" ON "services" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_accounts_deleted_at" ON "accounts" USING btree ("deleted_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_accounts_scheduled_deletion" ON "accounts" USING btree ("scheduled_deletion_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_nodes_last_heartbeat" ON "nodes" USING btree ("last_heartbeat");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_subscriptions_past_due_since" ON "subscriptions" USING btree ("past_due_since");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_storage_nodes_last_health_check" ON "storage_nodes" USING btree ("last_health_check");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_storage_volumes_deleted_at" ON "storage_volumes" USING btree ("deleted_at");
