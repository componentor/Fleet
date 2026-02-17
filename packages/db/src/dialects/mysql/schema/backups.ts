import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  boolean,
  int,
  bigint,
  json,
  timestamp,
} from 'drizzle-orm/mysql-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { services } from './services';

export const backups = mysqlTable('backups', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id)
    .notNull(),
  serviceId: varchar('service_id', { length: 36 }).references(() => services.id),
  type: varchar('type', { length: 255 }).default('manual'),
  status: varchar('status', { length: 255 }).default('pending'),
  storagePath: varchar('storage_path', { length: 255 }),
  storageBackend: varchar('storage_backend', { length: 255 }).default('nfs'),
  sizeBytes: bigint('size_bytes', { mode: 'bigint' }).default(sql`0`),
  contents: json('contents').$default(() => ([])),
  createdAt: timestamp('created_at').defaultNow(),
  expiresAt: timestamp('expires_at'),
});

export const backupSchedules = mysqlTable('backup_schedules', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id)
    .notNull(),
  serviceId: varchar('service_id', { length: 36 }).references(() => services.id),
  cron: varchar('cron', { length: 255 }).notNull(),
  retentionDays: int('retention_days').default(30),
  retentionCount: int('retention_count').default(10),
  storageBackend: varchar('storage_backend', { length: 255 }).default('nfs'),
  enabled: boolean('enabled').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  lastRunAt: timestamp('last_run_at'),
});

export const backupsRelations = relations(backups, ({ one }) => ({
  account: one(accounts, {
    fields: [backups.accountId],
    references: [accounts.id],
  }),
  service: one(services, {
    fields: [backups.serviceId],
    references: [services.id],
  }),
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
