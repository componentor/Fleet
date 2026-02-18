import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';

export const services = sqliteTable('services', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(),
  image: text('image').notNull(),
  replicas: integer('replicas').default(1),
  env: text('env', { mode: 'json' }).$default(() => ({})),
  ports: text('ports', { mode: 'json' }).$default(() => ([])),
  volumes: text('volumes', { mode: 'json' }).$default(() => ([])),
  dockerServiceId: text('docker_service_id'),
  githubRepo: text('github_repo'),
  githubBranch: text('github_branch'),
  autoDeploy: integer('auto_deploy', { mode: 'boolean' }).default(false),
  githubWebhookId: integer('github_webhook_id'),
  domain: text('domain'),
  sslEnabled: integer('ssl_enabled', { mode: 'boolean' }).default(true),
  status: text('status').default('stopped'),
  nodeConstraint: text('node_constraint'),
  placementConstraints: text('placement_constraints', { mode: 'json' }).$default(() => ([])),
  updateParallelism: integer('update_parallelism').default(1),
  updateDelay: text('update_delay').default('10s'),
  rollbackOnFailure: integer('rollback_on_failure', { mode: 'boolean' }).default(true),
  healthCheck: text('health_check', { mode: 'json' }),
  cpuLimit: integer('cpu_limit'),
  memoryLimit: integer('memory_limit'),
  cpuReservation: integer('cpu_reservation'),
  memoryReservation: integer('memory_reservation'),
  sourceType: text('source_type'),
  sourcePath: text('source_path'),
  stackId: text('stack_id'),
  stoppedAt: integer('stopped_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  deletedAt: integer('deleted_at', { mode: 'timestamp' }),
}, (table) => [
  index('idx_services_account_id').on(table.accountId),
  index('idx_services_status').on(table.status),
  index('idx_services_stack_id').on(table.stackId),
]);

export const deployments = sqliteTable('deployments', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceId: text('service_id')
    .references(() => services.id, { onDelete: 'cascade' })
    .notNull(),
  commitSha: text('commit_sha'),
  status: text('status').default('pending'),
  log: text('log').default(''),
  imageTag: text('image_tag'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_deployments_service_id').on(table.serviceId),
]);

export const servicesRelations = relations(services, ({ one, many }) => ({
  account: one(accounts, {
    fields: [services.accountId],
    references: [accounts.id],
  }),
  deployments: many(deployments),
}));

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  service: one(services, {
    fields: [deployments.serviceId],
    references: [services.id],
  }),
}));
