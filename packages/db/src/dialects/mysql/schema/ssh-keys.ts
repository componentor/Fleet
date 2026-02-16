import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  boolean,
  json,
  timestamp,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { users } from './users.js';
import { services } from './services.js';

export const sshKeys = mysqlTable('ssh_keys', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: varchar('user_id', { length: 36 })
    .references(() => users.id)
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  publicKey: text('public_key').notNull(),
  fingerprint: varchar('fingerprint', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const sshAccessRules = mysqlTable('ssh_access_rules', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  serviceId: varchar('service_id', { length: 36 })
    .references(() => services.id)
    .notNull(),
  allowedIps: json('allowed_ips').$default(() => ([])),
  enabled: boolean('enabled').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

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
