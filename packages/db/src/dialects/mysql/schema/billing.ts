import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  int,
  bigint,
  json,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts.js';

export const billingPlans = mysqlTable('billing_plans', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id)
    .notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  stripePriceId: varchar('stripe_price_id', { length: 255 }),
  cpuLimit: int('cpu_limit').notNull(),
  memoryLimit: int('memory_limit').notNull(),
  containerLimit: int('container_limit').notNull(),
  storageLimit: int('storage_limit').notNull(),
  priceCents: int('price_cents').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const subscriptions = mysqlTable('subscriptions', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id)
    .notNull(),
  planId: varchar('plan_id', { length: 36 })
    .references(() => billingPlans.id)
    .notNull(),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }),
  status: varchar('status', { length: 255 }).default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const usageRecords = mysqlTable('usage_records', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id)
    .notNull(),
  containers: int('containers').default(0),
  cpuSeconds: bigint('cpu_seconds', { mode: 'bigint' }).default(sql`0`),
  memoryMbHours: bigint('memory_mb_hours', { mode: 'bigint' }).default(sql`0`),
  storageGb: int('storage_gb').default(0),
  recordedAt: timestamp('recorded_at').defaultNow(),
});

export const pricingConfig = mysqlTable(
  'pricing_config',
  {
    id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
    accountId: varchar('account_id', { length: 36 })
      .references(() => accounts.id)
      .notNull(),
    containerFee: int('container_fee').default(0),
    cpuFee: int('cpu_fee').default(0),
    memoryFee: int('memory_fee').default(0),
    storageFee: int('storage_fee').default(0),
    bandwidthFee: int('bandwidth_fee').default(0),
    domainMarkupPercent: int('domain_markup_percent').default(0),
    backupStorageFee: int('backup_storage_fee').default(0),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => [uniqueIndex('pricing_config_account_idx').on(table.accountId)],
);

export const billingPlansRelations = relations(
  billingPlans,
  ({ one, many }) => ({
    account: one(accounts, {
      fields: [billingPlans.accountId],
      references: [accounts.id],
    }),
    subscriptions: many(subscriptions),
  }),
);

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  account: one(accounts, {
    fields: [subscriptions.accountId],
    references: [accounts.id],
  }),
  plan: one(billingPlans, {
    fields: [subscriptions.planId],
    references: [billingPlans.id],
  }),
}));

export const usageRecordsRelations = relations(usageRecords, ({ one }) => ({
  account: one(accounts, {
    fields: [usageRecords.accountId],
    references: [accounts.id],
  }),
}));

export const pricingConfigRelations = relations(pricingConfig, ({ one }) => ({
  account: one(accounts, {
    fields: [pricingConfig.accountId],
    references: [accounts.id],
  }),
}));
