import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  bigint,
  jsonb,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { services } from './services';

export const backups = pgTable('backups', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
  parentId: uuid('parent_id'), // FK to level-0 backup in incremental chain
  level: integer('level').default(0), // 0 = full, 1+ = incremental
  clusterId: uuid('cluster_id'), // Storage cluster used for this backup
  type: varchar('type').default('manual'),
  status: varchar('status').default('pending'),
  storagePath: varchar('storage_path'),
  storageBackend: varchar('storage_backend').default('nfs'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).default(sql`0`),
  contents: jsonb('contents').default([]),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at'),
}, (table) => [
  index('idx_backups_account_id').on(table.accountId),
  index('idx_backups_service_id').on(table.serviceId),
  index('idx_backups_parent_id').on(table.parentId),
]);

export const backupSchedules = pgTable('backup_schedules', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
  clusterId: uuid('cluster_id'), // Storage cluster for backups created by this schedule
  cron: varchar('cron').notNull(),
  retentionDays: integer('retention_days').default(30),
  retentionCount: integer('retention_count').default(10),
  storageBackend: varchar('storage_backend').default('nfs'),
  enabled: boolean('enabled').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  lastRunAt: timestamp('last_run_at'),
}, (table) => [
  index('idx_backup_schedules_account_id').on(table.accountId),
  index('idx_backup_schedules_service_id').on(table.serviceId),
]);

export const backupsRelations = relations(backups, ({ one, many }) => ({
  account: one(accounts, {
    fields: [backups.accountId],
    references: [accounts.id],
  }),
  service: one(services, {
    fields: [backups.serviceId],
    references: [services.id],
  }),
  parent: one(backups, {
    fields: [backups.parentId],
    references: [backups.id],
    relationName: 'backupChain',
  }),
  children: many(backups, { relationName: 'backupChain' }),
}));

export const backupSchedulesRelations = relations(
  backupSchedules,
  ({ one }) => ({
    account: one(accounts, {
      fields: [backupSchedules.accountId],
      references: [accounts.id],
    }),
    service: one(services, {
      fields: [backupSchedules.serviceId],
      references: [services.id],
    }),
  }),
);
