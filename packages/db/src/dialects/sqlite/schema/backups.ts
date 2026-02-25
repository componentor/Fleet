import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { services } from './services';

export const backups = sqliteTable('backups', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  serviceId: text('service_id').references(() => services.id, { onDelete: 'set null' }),
  parentId: text('parent_id'), // FK to level-0 backup in incremental chain
  level: integer('level').default(0), // 0 = full, 1+ = incremental
  clusterId: text('cluster_id'), // Storage cluster used for this backup
  type: text('type').default('manual'),
  status: text('status').default('pending'),
  storagePath: text('storage_path'),
  storageBackend: text('storage_backend').default('nfs'),
  sizeBytes: integer('size_bytes', { mode: 'number' }).default(0),
  contents: text('contents', { mode: 'json' }).$default(() => ([])),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
}, (table) => [
  index('idx_backups_account_id').on(table.accountId),
  index('idx_backups_service_id').on(table.serviceId),
  index('idx_backups_parent_id').on(table.parentId),
]);

export const backupSchedules = sqliteTable('backup_schedules', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  serviceId: text('service_id').references(() => services.id, { onDelete: 'set null' }),
  clusterId: text('cluster_id'), // Storage cluster for backups created by this schedule
  cron: text('cron').notNull(),
  retentionDays: integer('retention_days').default(30),
  retentionCount: integer('retention_count').default(10),
  storageBackend: text('storage_backend').default('nfs'),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
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
