import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  boolean,
  int,
  json,
  timestamp,
  index,
} from 'drizzle-orm/mysql-core';
import { relations } from 'drizzle-orm';
import { accounts } from './accounts';
import { users } from './users';

export const dnsZones = mysqlTable('dns_zones', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  domain: varchar('domain', { length: 255 }).notNull(),
  verified: boolean('verified').default(false),
  nameservers: json('nameservers').$default(() => ([])),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_dns_zones_account_id').on(table.accountId),
]);

export const dnsRecords = mysqlTable('dns_records', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  zoneId: varchar('zone_id', { length: 36 })
    .references(() => dnsZones.id, { onDelete: 'cascade' })
    .notNull(),
  type: varchar('type', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  content: varchar('content', { length: 16384 }).notNull(),
  ttl: int('ttl').default(3600),
  priority: int('priority'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_dns_records_zone_id').on(table.zoneId),
]);

export const domainRegistrars = mysqlTable('domain_registrars', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: varchar('provider', { length: 255 }).notNull(),
  apiKey: varchar('api_key', { length: 255 }).notNull(),
  apiSecret: varchar('api_secret', { length: 255 }),
  config: json('config').$default(() => ({})),
  enabled: boolean('enabled').default(true),
  createdBy: varchar('created_by', { length: 36 })
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const domainRegistrations = mysqlTable('domain_registrations', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  registrarId: varchar('registrar_id', { length: 36 })
    .references(() => domainRegistrars.id, { onDelete: 'set null' }),
  domain: varchar('domain', { length: 255 }).notNull(),
  status: varchar('status', { length: 255 }).default('pending'),
  registeredAt: timestamp('registered_at'),
  expiresAt: timestamp('expires_at'),
  autoRenew: boolean('auto_renew').default(true),
  registrarDomainId: varchar('registrar_domain_id', { length: 255 }),
  stripePaymentId: varchar('stripe_payment_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_domain_registrations_account_id').on(table.accountId),
  index('idx_domain_registrations_registrar_id').on(table.registrarId),
]);

export const domainTldPricing = mysqlTable('domain_tld_pricing', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  tld: varchar('tld', { length: 63 }).notNull().unique(),
  providerRegistrationPrice: int('provider_registration_price').notNull(),
  providerRenewalPrice: int('provider_renewal_price').notNull(),
  markupType: varchar('markup_type', { length: 20 }).notNull().default('percentage'),
  markupValue: int('markup_value').notNull().default(20),
  sellRegistrationPrice: int('sell_registration_price').notNull(),
  sellRenewalPrice: int('sell_renewal_price').notNull(),
  enabled: boolean('enabled').default(true),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
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
