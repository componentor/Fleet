import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { users } from './users';

export const dnsZones = pgTable('dns_zones', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  domain: varchar('domain', { length: 255 }).notNull(),
  verified: boolean('verified').default(false),
  nameservers: jsonb('nameservers').default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const dnsRecords = pgTable('dns_records', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  zoneId: uuid('zone_id')
    .references(() => dnsZones.id, { onDelete: 'cascade' })
    .notNull(),
  type: varchar('type').notNull(),
  name: varchar('name').notNull(),
  content: varchar('content').notNull(),
  ttl: integer('ttl').default(3600),
  priority: integer('priority'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const domainRegistrars = pgTable('domain_registrars', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  provider: varchar('provider').notNull(),
  apiKey: varchar('api_key').notNull(),
  apiSecret: varchar('api_secret'),
  config: jsonb('config').default({}),
  enabled: boolean('enabled').default(true),
  createdBy: uuid('created_by')
    .references(() => users.id, { onDelete: 'set null' })
    .notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const domainRegistrations = pgTable('domain_registrations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  registrarId: uuid('registrar_id')
    .references(() => domainRegistrars.id, { onDelete: 'set null' })
    .notNull(),
  domain: varchar('domain').notNull(),
  status: varchar('status').default('pending'),
  registeredAt: timestamp('registered_at'),
  expiresAt: timestamp('expires_at'),
  autoRenew: boolean('auto_renew').default(true),
  registrarDomainId: varchar('registrar_domain_id'),
  stripePaymentId: varchar('stripe_payment_id'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const domainTldPricing = pgTable('domain_tld_pricing', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  tld: varchar('tld', { length: 63 }).notNull().unique(),
  providerRegistrationPrice: integer('provider_registration_price').notNull(),
  providerRenewalPrice: integer('provider_renewal_price').notNull(),
  markupType: varchar('markup_type', { length: 20 }).notNull().default('percentage'),
  markupValue: integer('markup_value').notNull().default(20),
  sellRegistrationPrice: integer('sell_registration_price').notNull(),
  sellRenewalPrice: integer('sell_renewal_price').notNull(),
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
