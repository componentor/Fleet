import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  boolean,
  int,
  json,
  timestamp,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { accounts } from './accounts';

export const services = mysqlTable('services', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  image: varchar('image', { length: 255 }).notNull(),
  replicas: int('replicas').default(1),
  env: json('env').$default(() => ({})),
  ports: json('ports').$default(() => ([])),
  volumes: json('volumes').$default(() => ([])),
  dockerServiceId: varchar('docker_service_id', { length: 255 }),
  githubRepo: varchar('github_repo', { length: 255 }),
  githubBranch: varchar('github_branch', { length: 255 }),
  autoDeploy: boolean('auto_deploy').default(false),
  githubWebhookId: int('github_webhook_id'),
  domain: varchar('domain', { length: 255 }),
  sslEnabled: boolean('ssl_enabled').default(true),
  status: varchar('status', { length: 255 }).default('stopped'),
  nodeConstraint: varchar('node_constraint', { length: 255 }),
  region: varchar('region', { length: 100 }),
  placementConstraints: json('placement_constraints').$default(() => ([])),
  updateParallelism: int('update_parallelism').default(1),
  updateDelay: varchar('update_delay', { length: 255 }).default('10s'),
  rollbackOnFailure: boolean('rollback_on_failure').default(true),
  healthCheck: json('health_check'),
  cpuLimit: int('cpu_limit'),
  memoryLimit: int('memory_limit'),
  cpuReservation: int('cpu_reservation'),
  memoryReservation: int('memory_reservation'),
  restartCondition: varchar('restart_condition', { length: 20 }).default('on-failure'),
  restartMaxAttempts: int('restart_max_attempts').default(3),
  restartDelay: varchar('restart_delay', { length: 20 }).default('10s'),
  sourceType: varchar('source_type', { length: 20 }),
  sourcePath: varchar('source_path', { length: 500 }),
  dockerfile: text('dockerfile'),
  tags: json('tags').$default(() => ([])),
  stackId: varchar('stack_id', { length: 36 }),
  stoppedAt: timestamp('stopped_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  deletedAt: timestamp('deleted_at'),
}, (table) => [
  index('idx_services_account_id').on(table.accountId),
  index('idx_services_status').on(table.status),
  index('idx_services_stack_id').on(table.stackId),
  index('idx_services_github_autodeploy').on(table.githubRepo, table.githubBranch, table.autoDeploy),
  index('idx_services_deleted_at').on(table.deletedAt),
]);

export const deployments = mysqlTable('deployments', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceId: varchar('service_id', { length: 36 })
    .references(() => services.id, { onDelete: 'cascade' })
    .notNull(),
  commitSha: varchar('commit_sha', { length: 255 }),
  status: varchar('status', { length: 255 }).default('pending'),
  log: text('log').default(''),
  imageTag: varchar('image_tag', { length: 255 }),
  notes: text('notes'),
  progressStep: varchar('progress_step', { length: 50 }),
  trigger: varchar('trigger', { length: 20 }),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_deployments_service_id').on(table.serviceId),
  index('idx_deployments_status').on(table.status),
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
