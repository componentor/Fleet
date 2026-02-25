import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  boolean,
  int,
  bigint,
  json,
  timestamp,
  index,
} from 'drizzle-orm/mysql-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { services } from './services';

export const backups = mysqlTable('backups', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  serviceId: varchar('service_id', { length: 36 }).references(() => services.id, { onDelete: 'set null' }),
  parentId: varchar('parent_id', { length: 36 }), // FK to level-0 backup in incremental chain
  level: int('level').default(0), // 0 = full, 1+ = incremental
  clusterId: varchar('cluster_id', { length: 36 }), // Storage cluster used for this backup
  type: varchar('type', { length: 255 }).default('manual'),
  status: varchar('status', { length: 255 }).default('pending'),
  storagePath: varchar('storage_path', { length: 255 }),
  storageBackend: varchar('storage_backend', { length: 255 }).default('nfs'),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).default(sql`0`),
  contents: json('contents').$default(() => ([])),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at'),
}, (table) => [
  index('idx_backups_account_id').on(table.accountId),
  index('idx_backups_service_id').on(table.serviceId),
  index('idx_backups_parent_id').on(table.parentId),
]);

export const backupSchedules = mysqlTable('backup_schedules', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  serviceId: varchar('service_id', { length: 36 }).references(() => services.id, { onDelete: 'set null' }),
  clusterId: varchar('cluster_id', { length: 36 }), // Storage cluster for backups created by this schedule
  cron: varchar('cron', { length: 255 }).notNull(),
  retentionDays: int('retention_days').default(30),
  retentionCount: int('retention_count').default(10),
  storageBackend: varchar('storage_backend', { length: 255 }).default('nfs'),
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
