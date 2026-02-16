import crypto from 'node:crypto';
import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts.js';

export const billingPlans = sqliteTable('billing_plans', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  name: text('name').notNull(),
  stripePriceId: text('stripe_price_id'),
  cpuLimit: integer('cpu_limit').notNull(),
  memoryLimit: integer('memory_limit').notNull(),
  containerLimit: integer('container_limit').notNull(),
  storageLimit: integer('storage_limit').notNull(),
  priceCents: integer('price_cents').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  planId: text('plan_id')
    .references(() => billingPlans.id)
    .notNull(),
  stripeSubscriptionId: text('stripe_subscription_id'),
  status: text('status').default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const usageRecords = sqliteTable('usage_records', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id)
    .notNull(),
  containers: integer('containers').default(0),
  cpuSeconds: integer('cpu_seconds', { mode: 'number' }).default(0),
  memoryMbHours: integer('memory_mb_hours', { mode: 'number' }).default(0),
  storageGb: integer('storage_gb').default(0),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const pricingConfig = sqliteTable(
  'pricing_config',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    accountId: text('account_id')
      .references(() => accounts.id)
      .notNull(),
    containerFee: integer('container_fee').default(0),
    cpuFee: integer('cpu_fee').default(0),
    memoryFee: integer('memory_fee').default(0),
    storageFee: integer('storage_fee').default(0),
    bandwidthFee: integer('bandwidth_fee').default(0),
    domainMarkupPercent: integer('domain_markup_percent').default(0),
    backupStorageFee: integer('backup_storage_fee').default(0),
    updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
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
