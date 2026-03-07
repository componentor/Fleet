import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  boolean,
  int,
  json,
  datetime,
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { sql, relations } from 'drizzle-orm';
import { accounts } from './accounts';
import { users } from './users';
import { services } from './services';

export const dnsZones = mysqlTable('dns_zones', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  domain: varchar('domain', { length: 255 }).notNull(),
  verified: boolean('verified').default(false),
  verificationToken: varchar('verification_token', { length: 255 }),
  nameservers: json('nameservers').$default(() => ([])),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
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
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
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
  createdAt: datetime('created_at').default(sql`(now())`),
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
  registeredAt: datetime('registered_at'),
  expiresAt: datetime('expires_at'),
  autoRenew: boolean('auto_renew').default(true),
  registrarDomainId: varchar('registrar_domain_id', { length: 255 }),
  stripePaymentId: varchar('stripe_payment_id', { length: 255 }),
  createdAt: datetime('created_at').default(sql`(now())`),
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
  renewalMarkupType: varchar('renewal_markup_type', { length: 20 }),
  renewalMarkupValue: int('renewal_markup_value'),
  sellRegistrationPrice: int('sell_registration_price').notNull(),
  sellRenewalPrice: int('sell_renewal_price').notNull(),
  enabled: boolean('enabled').default(true),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
});

export const domainTldCurrencyPrices = mysqlTable('domain_tld_currency_prices', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  tldPricingId: varchar('tld_pricing_id', { length: 36 })
    .references(() => domainTldPricing.id, { onDelete: 'cascade' })
    .notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  sellRegistrationPrice: int('sell_registration_price').notNull(),
  sellRenewalPrice: int('sell_renewal_price').notNull(),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
}, (table) => [
  uniqueIndex('idx_tld_currency_prices_tld_currency').on(table.tldPricingId, table.currency),
]);

export const sharedDomains = mysqlTable('shared_domains', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  domain: varchar('domain', { length: 255 }).notNull().unique(),
  enabled: boolean('enabled').default(true),
  pricingType: varchar('pricing_type', { length: 20 }).notNull().default('free'),
  price: int('price').notNull().default(0),
  currency: varchar('currency', { length: 3 }).notNull().default('USD'),
  maxPerAccount: int('max_per_account').notNull().default(0),
  createdBy: varchar('created_by', { length: 36 })
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
});

export const subdomainClaims = mysqlTable('subdomain_claims', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  sharedDomainId: varchar('shared_domain_id', { length: 36 })
    .references(() => sharedDomains.id, { onDelete: 'cascade' })
    .notNull(),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  subdomain: varchar('subdomain', { length: 63 }).notNull(),
  serviceId: varchar('service_id', { length: 36 })
    .references(() => services.id, { onDelete: 'set null' }),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  stripePaymentId: varchar('stripe_payment_id', { length: 255 }),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  createdAt: datetime('created_at').default(sql`(now())`),
  updatedAt: datetime('updated_at').default(sql`(now())`),
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
