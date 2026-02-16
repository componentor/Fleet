import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  boolean,
  int,
  json,
  timestamp,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { accounts } from './accounts.js';
import { users } from './users.js';

export const dnsZones = mysqlTable('dns_zones', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id)
    .notNull(),
  domain: varchar('domain', { length: 255 }).notNull(),
  verified: boolean('verified').default(false),
  nameservers: json('nameservers').$default(() => ([])),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const dnsRecords = mysqlTable('dns_records', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  zoneId: varchar('zone_id', { length: 36 })
    .references(() => dnsZones.id)
    .notNull(),
  type: varchar('type', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  content: varchar('content', { length: 255 }).notNull(),
  ttl: int('ttl').default(3600),
  priority: int('priority'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const domainRegistrars = mysqlTable('domain_registrars', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: varchar('provider', { length: 255 }).notNull(),
  apiKey: varchar('api_key', { length: 255 }).notNull(),
  apiSecret: varchar('api_secret', { length: 255 }),
  config: json('config').$default(() => ({})),
  enabled: boolean('enabled').default(true),
  createdBy: varchar('created_by', { length: 36 })
    .references(() => users.id)
    .notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const domainRegistrations = mysqlTable('domain_registrations', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id)
    .notNull(),
  registrarId: varchar('registrar_id', { length: 36 })
    .references(() => domainRegistrars.id)
    .notNull(),
  domain: varchar('domain', { length: 255 }).notNull(),
  status: varchar('status', { length: 255 }).default('pending'),
  registeredAt: timestamp('registered_at'),
  expiresAt: timestamp('expires_at'),
  autoRenew: boolean('auto_renew').default(true),
  registrarDomainId: varchar('registrar_domain_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
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
