import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { users } from './users';
import { services } from './services';

export const sshKeys = pgTable('ssh_keys', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name').notNull(),
  publicKey: text('public_key').notNull(),
  fingerprint: varchar('fingerprint').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const sshAccessRules = pgTable('ssh_access_rules', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  serviceId: uuid('service_id')
    .references(() => services.id, { onDelete: 'cascade' })
    .notNull(),
  allowedIps: jsonb('allowed_ips').default([]),
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
