import {
  pgTable,
  uuid,
  varchar,
  boolean,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { users } from './users';
import { services } from './services';

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
}, (table) => [
  index('idx_dns_zones_account_id').on(table.accountId),
]);

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
}, (table) => [
  index('idx_dns_records_zone_id').on(table.zoneId),
]);

export const domainRegistrars = pgTable('domain_registrars', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  provider: varchar('provider').notNull(),
  apiKey: varchar('api_key').notNull(),
  apiSecret: varchar('api_secret'),
  config: jsonb('config').default({}),
  enabled: boolean('enabled').default(true),
  createdBy: uuid('created_by')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const domainRegistrations = pgTable('domain_registrations', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  registrarId: uuid('registrar_id')
    .references(() => domainRegistrars.id, { onDelete: 'set null' }),
  domain: varchar('domain').notNull(),
  status: varchar('status').default('pending'),
  registeredAt: timestamp('registered_at'),
  expiresAt: timestamp('expires_at'),
  autoRenew: boolean('auto_renew').default(true),
  registrarDomainId: varchar('registrar_domain_id'),
  stripePaymentId: varchar('stripe_payment_id'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_domain_registrations_account_id').on(table.accountId),
  index('idx_domain_registrations_registrar_id').on(table.registrarId),
]);

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

export const sharedDomains = pgTable('shared_domains', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  domain: varchar('domain', { length: 255 }).notNull().unique(),
  enabled: boolean('enabled').default(true),
  pricingType: varchar('pricing_type', { length: 20 }).notNull().default('free'),
  price: integer('price').notNull().default(0),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  maxPerAccount: integer('max_per_account').notNull().default(0),
  createdBy: uuid('created_by')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const subdomainClaims = pgTable('subdomain_claims', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  sharedDomainId: uuid('shared_domain_id')
    .references(() => sharedDomains.id, { onDelete: 'cascade' })
    .notNull(),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  subdomain: varchar('subdomain', { length: 63 }).notNull(),
  serviceId: uuid('service_id')
    .references(() => services.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  stripePaymentId: varchar('stripe_payment_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_subdomain_claims_shared_domain_id').on(table.sharedDomainId),
  index('idx_subdomain_claims_account_id').on(table.accountId),
  uniqueIndex('idx_subdomain_claims_unique').on(table.sharedDomainId, table.subdomain),
]);

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

export const sharedDomainsRelations = relations(
  sharedDomains,
  ({ one, many }) => ({
    createdByUser: one(users, {
      fields: [sharedDomains.createdBy],
      references: [users.id],
    }),
    claims: many(subdomainClaims),
  }),
);

export const subdomainClaimsRelations = relations(
  subdomainClaims,
  ({ one }) => ({
    sharedDomain: one(sharedDomains, {
      fields: [subdomainClaims.sharedDomainId],
      references: [sharedDomains.id],
    }),
    account: one(accounts, {
      fields: [subdomainClaims.accountId],
      references: [accounts.id],
    }),
    service: one(services, {
      fields: [subdomainClaims.serviceId],
      references: [services.id],
    }),
  }),
);
