import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';

export const services = pgTable('services', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  image: varchar('image').notNull(),
  replicas: integer('replicas').default(1),
  env: jsonb('env').default({}),
  ports: jsonb('ports').default([]),
  volumes: jsonb('volumes').default([]),
  dockerServiceId: varchar('docker_service_id'),
  githubRepo: varchar('github_repo'),
  githubBranch: varchar('github_branch'),
  autoDeploy: boolean('auto_deploy').default(false),
  githubWebhookId: integer('github_webhook_id'),
  domain: varchar('domain'),
  sslEnabled: boolean('ssl_enabled').default(true),
  status: varchar('status').default('stopped'),
  nodeConstraint: varchar('node_constraint'),
  region: varchar('region'),
  placementConstraints: jsonb('placement_constraints').default([]),
  updateParallelism: integer('update_parallelism').default(1),
  updateDelay: varchar('update_delay').default('10s'),
  rollbackOnFailure: boolean('rollback_on_failure').default(true),
  healthCheck: jsonb('health_check'),
  cpuLimit: integer('cpu_limit'),
  memoryLimit: integer('memory_limit'),
  cpuReservation: integer('cpu_reservation'),
  memoryReservation: integer('memory_reservation'),
  restartCondition: varchar('restart_condition').default('on-failure'),
  restartMaxAttempts: integer('restart_max_attempts').default(3),
  restartDelay: varchar('restart_delay').default('10s'),
  sourceType: varchar('source_type', { length: 20 }),
  sourcePath: varchar('source_path'),
  dockerfile: text('dockerfile'),
  registryPollEnabled: boolean('registry_poll_enabled').default(false),
  registryPollInterval: integer('registry_poll_interval').default(300),
  registryPollDigest: varchar('registry_poll_digest'),
  registryWebhookSecret: varchar('registry_webhook_secret'),
  tags: jsonb('tags').default([]),
  orchestrator: varchar('orchestrator', { length: 20 }),
  stackId: varchar('stack_id'),
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

export const deployments = pgTable('deployments', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serviceId: uuid('service_id')
    .references(() => services.id, { onDelete: 'cascade' })
    .notNull(),
  commitSha: varchar('commit_sha'),
  status: varchar('status').default('pending'),
  log: text('log').default(''),
  imageTag: varchar('image_tag'),
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
