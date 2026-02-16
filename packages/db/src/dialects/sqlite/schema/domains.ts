import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts.js';
import { users } from './users.js';

export const dnsZones = sqliteTable('dns_zones', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  domain: text('domain').notNull(),
  verified: integer('verified', { mode: 'boolean' }).default(false),
  nameservers: text('nameservers', { mode: 'json' }).$default(() => ([])),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const dnsRecords = sqliteTable('dns_records', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  zoneId: text('zone_id')
    .references(() => dnsZones.id)
    .notNull(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  content: text('content').notNull(),
  ttl: integer('ttl').default(3600),
  priority: integer('priority'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const domainRegistrars = sqliteTable('domain_registrars', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: text('provider').notNull(),
  apiKey: text('api_key').notNull(),
  apiSecret: text('api_secret'),
  config: text('config', { mode: 'json' }).$default(() => ({})),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  createdBy: text('created_by')
    .references(() => users.id)
    .notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const domainRegistrations = sqliteTable('domain_registrations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  registrarId: text('registrar_id')
    .references(() => domainRegistrars.id)
    .notNull(),
  domain: text('domain').notNull(),
  status: text('status').default('pending'),
  registeredAt: integer('registered_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  autoRenew: integer('auto_renew', { mode: 'boolean' }).default(true),
  registrarDomainId: text('registrar_domain_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const dnsZonesRelations = relations(dnsZones, ({ one, many }) => ({
  account: one(accounts, {
    fields: [dnsZones.accountId],
    references: [accounts.id],
  }),
  records: many(dnsRecords),
}));

export const dnsRecordsRelations = relations(dnsRecords, ({ one }) => ({
  zone: one(dnsZones, {
    fields: [dnsRecords.zoneId],
    references: [dnsZones.id],
  }),
}));

export const domainRegistrarsRelations = relations(
  domainRegistrars,
  ({ one, many }) => ({
    createdByUser: one(users, {
      fields: [domainRegistrars.createdBy],
      references: [users.id],
    }),
    registrations: many(domainRegistrations),
  }),
);

export const domainRegistrationsRelations = relations(
  domainRegistrations,
  ({ one }) => ({
    account: one(accounts, {
      fields: [domainRegistrations.accountId],
      references: [accounts.id],
    }),
    registrar: one(domainRegistrars, {
      fields: [domainRegistrations.registrarId],
      references: [domainRegistrars.id],
    }),
  }),
);
