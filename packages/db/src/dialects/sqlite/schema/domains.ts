import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { users } from './users';
import { services } from './services';

export const dnsZones = sqliteTable('dns_zones', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  domain: text('domain').notNull(),
  verified: integer('verified', { mode: 'boolean' }).default(false),
  verificationToken: text('verification_token'),
  nameservers: text('nameservers', { mode: 'json' }).$default(() => ([])),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_dns_zones_account_id').on(table.accountId),
]);

export const dnsRecords = sqliteTable('dns_records', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  zoneId: text('zone_id')
    .references(() => dnsZones.id, { onDelete: 'cascade' })
    .notNull(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  content: text('content').notNull(),
  ttl: integer('ttl').default(3600),
  priority: integer('priority'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_dns_records_zone_id').on(table.zoneId),
]);

export const domainRegistrars = sqliteTable('domain_registrars', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  provider: text('provider').notNull(),
  apiKey: text('api_key').notNull(),
  apiSecret: text('api_secret'),
  config: text('config', { mode: 'json' }).$default(() => ({})),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  createdBy: text('created_by')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const domainRegistrations = sqliteTable('domain_registrations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  registrarId: text('registrar_id')
    .references(() => domainRegistrars.id, { onDelete: 'set null' }),
  domain: text('domain').notNull(),
  status: text('status').default('pending'),
  registeredAt: integer('registered_at', { mode: 'timestamp' }),
  expiresAt: integer('expires_at', { mode: 'timestamp' }),
  autoRenew: integer('auto_renew', { mode: 'boolean' }).default(true),
  registrarDomainId: text('registrar_domain_id'),
  stripePaymentId: text('stripe_payment_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_domain_registrations_account_id').on(table.accountId),
  index('idx_domain_registrations_registrar_id').on(table.registrarId),
]);

export const domainTldPricing = sqliteTable('domain_tld_pricing', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  tld: text('tld').notNull().unique(),
  providerRegistrationPrice: integer('provider_registration_price').notNull(),
  providerRenewalPrice: integer('provider_renewal_price').notNull(),
  markupType: text('markup_type').notNull().default('percentage'),
  markupValue: integer('markup_value').notNull().default(20),
  renewalMarkupType: text('renewal_markup_type'),
  renewalMarkupValue: integer('renewal_markup_value'),
  sellRegistrationPrice: integer('sell_registration_price').notNull(),
  sellRenewalPrice: integer('sell_renewal_price').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  currency: text('currency').notNull().default('USD'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const sharedDomains = sqliteTable('shared_domains', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  domain: text('domain').notNull().unique(),
  enabled: integer('enabled', { mode: 'boolean' }).default(true),
  pricingType: text('pricing_type').notNull().default('free'),
  price: integer('price').notNull().default(0),
  currency: text('currency').notNull().default('USD'),
  maxPerAccount: integer('max_per_account').notNull().default(0),
  createdBy: text('created_by')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const subdomainClaims = sqliteTable('subdomain_claims', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sharedDomainId: text('shared_domain_id')
    .references(() => sharedDomains.id, { onDelete: 'cascade' })
    .notNull(),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  subdomain: text('subdomain').notNull(),
  serviceId: text('service_id')
    .references(() => services.id, { onDelete: 'set null' }),
  status: text('status').notNull().default('active'),
  stripePaymentId: text('stripe_payment_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
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
