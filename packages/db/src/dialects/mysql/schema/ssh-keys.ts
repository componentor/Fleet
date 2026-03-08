import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  boolean,
  json,
  datetime,
  index,
} from 'drizzle-orm/mysql-core';
import { sql, relations } from 'drizzle-orm';
import { users } from './users';
import { services } from './services';

export const sshKeys = mysqlTable('ssh_keys', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: varchar('user_id', { length: 36 })
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  publicKey: text('public_key').notNull(),
  fingerprint: varchar('fingerprint', { length: 255 }).notNull(),
  nodeAccess: boolean('node_access').default(false),
  createdAt: datetime('created_at').default(sql`(now())`),
}, (table) => [
  index('idx_ssh_keys_user_id').on(table.userId),
]);

export const sshAccessRules = mysqlTable('ssh_access_rules', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceId: varchar('service_id', { length: 36 })
    .references(() => services.id, { onDelete: 'cascade' })
    .notNull(),
  allowedIps: json('allowed_ips').$default(() => ([])),
  enabled: boolean('enabled').default(true),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
}, (table) => [
  index('idx_ssh_access_rules_service_id').on(table.serviceId),
]);

export const sshKeysRelations = relations(sshKeys, ({ one }) => ({
  user: one(users, {
    fields: [sshKeys.userId],
    references: [users.id],
  }),
}));

export const sshAccessRulesRelations = relations(
  sshAccessRules,
  ({ one }) => ({
    service: one(services, {
      fields: [sshAccessRules.serviceId],
      references: [services.id],
    }),
  }),
);
