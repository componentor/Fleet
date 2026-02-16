import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  boolean,
  int,
  json,
  timestamp,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { accounts } from './accounts.js';

export const services = mysqlTable('services', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id)
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
  domain: varchar('domain', { length: 255 }),
  sslEnabled: boolean('ssl_enabled').default(true),
  status: varchar('status', { length: 255 }).default('stopped'),
  nodeConstraint: varchar('node_constraint', { length: 255 }),
  placementConstraints: json('placement_constraints').$default(() => ([])),
  updateParallelism: int('update_parallelism').default(1),
  updateDelay: varchar('update_delay', { length: 255 }).default('10s'),
  rollbackOnFailure: boolean('rollback_on_failure').default(true),
  healthCheck: json('health_check'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const deployments = mysqlTable('deployments', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceId: varchar('service_id', { length: 36 })
    .references(() => services.id)
    .notNull(),
  commitSha: varchar('commit_sha', { length: 255 }),
  status: varchar('status', { length: 255 }).default('pending'),
  log: text('log'),
  imageTag: varchar('image_tag', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
});

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
