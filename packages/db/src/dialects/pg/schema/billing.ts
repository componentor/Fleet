import {
  pgTable,
  uuid,
  varchar,
  integer,
  bigint,
  jsonb,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts.js';

export const billingPlans = pgTable('billing_plans', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id)
    .notNull(),
  name: varchar('name').notNull(),
  stripePriceId: varchar('stripe_price_id'),
  cpuLimit: integer('cpu_limit').notNull(),
  memoryLimit: integer('memory_limit').notNull(),
  containerLimit: integer('container_limit').notNull(),
  storageLimit: integer('storage_limit').notNull(),
  priceCents: integer('price_cents').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id)
    .notNull(),
  planId: uuid('plan_id')
    .references(() => billingPlans.id)
    .notNull(),
  stripeSubscriptionId: varchar('stripe_subscription_id'),
  status: varchar('status').default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id)
    .notNull(),
  containers: integer('containers').default(0),
  cpuSeconds: bigint('cpu_seconds', { mode: 'bigint' }).default(sql`0`),
  memoryMbHours: bigint('memory_mb_hours', { mode: 'bigint' }).default(sql`0`),
  storageGb: integer('storage_gb').default(0),
  recordedAt: timestamp('recorded_at').defaultNow(),
});

export const pricingConfig = pgTable(
  'pricing_config',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    accountId: uuid('account_id')
      .references(() => accounts.id)
      .notNull(),
    containerFee: integer('container_fee').default(0),
    cpuFee: integer('cpu_fee').default(0),
    memoryFee: integer('memory_fee').default(0),
    storageFee: integer('storage_fee').default(0),
    bandwidthFee: integer('bandwidth_fee').default(0),
    domainMarkupPercent: integer('domain_markup_percent').default(0),
    backupStorageFee: integer('backup_storage_fee').default(0),
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
