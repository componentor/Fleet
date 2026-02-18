import crypto from 'node:crypto';
import {
  mysqlTable,
  varchar,
  text,
  boolean,
  int,
  bigint,
  json,
  timestamp,
} from 'drizzle-orm/mysql-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';

export const billingPlans = mysqlTable('billing_plans', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).unique().notNull(),
  description: text('description'),
  sortOrder: int('sort_order').default(0),
  isDefault: boolean('is_default').default(false),
  isFree: boolean('is_free').default(false),
  visible: boolean('visible').default(true),
  cpuLimit: int('cpu_limit').notNull(),
  memoryLimit: int('memory_limit').notNull(),
  containerLimit: int('container_limit').notNull(),
  storageLimit: int('storage_limit').notNull(),
  bandwidthLimit: int('bandwidth_limit'),
  priceCents: int('price_cents').notNull(),
  stripeProductId: varchar('stripe_product_id', { length: 255 }),
  stripePriceIds: json('stripe_price_ids').$default(() => ({})),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const subscriptions = mysqlTable('subscriptions', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  planId: varchar('plan_id', { length: 36 })
    .references(() => billingPlans.id, { onDelete: 'set null' }),
  billingModel: varchar('billing_model', { length: 255 }).default('fixed'),
  stripeSubscriptionId: varchar('stripe_subscription_id', { length: 255 }).unique(),
  stripeCustomerId: varchar('stripe_customer_id', { length: 255 }),
  billingCycle: varchar('billing_cycle', { length: 255 }).default('monthly'),
  status: varchar('status', { length: 255 }).default('active'),
  trialEndsAt: timestamp('trial_ends_at'),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const usageRecords = mysqlTable('usage_records', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
  containers: int('containers').default(0),
  cpuSeconds: bigint('cpu_seconds', { mode: 'bigint' }).default(sql`0`),
  memoryMbHours: bigint('memory_mb_hours', { mode: 'bigint' }).default(sql`0`),
  storageGb: int('storage_gb').default(0),
  bandwidthGb: int('bandwidth_gb').default(0),
  recordedAt: timestamp('recorded_at').defaultNow(),
});

export const pricingConfig = mysqlTable('pricing_config', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  cpuCentsPerHour: int('cpu_cents_per_hour').default(0),
  memoryCentsPerGbHour: int('memory_cents_per_gb_hour').default(0),
  storageCentsPerGbMonth: int('storage_cents_per_gb_month').default(0),
  bandwidthCentsPerGb: int('bandwidth_cents_per_gb').default(0),
  containerCentsPerHour: int('container_cents_per_hour').default(0),
  domainMarkupPercent: int('domain_markup_percent').default(0),
  backupStorageCentsPerGb: int('backup_storage_cents_per_gb').default(0),
  locationPricingEnabled: boolean('location_pricing_enabled').default(false),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const locationMultipliers = mysqlTable('location_multipliers', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  locationKey: varchar('location_key', { length: 255 }).unique().notNull(),
  label: varchar('label', { length: 255 }).notNull(),
  multiplier: int('multiplier').default(100),
  createdAt: timestamp('created_at').defaultNow(),
});

export const billingConfig = mysqlTable('billing_config', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  billingModel: varchar('billing_model', { length: 255 }).default('fixed').notNull(),
  allowUserChoice: boolean('allow_user_choice').default(false),
  allowedCycles: json('allowed_cycles').$default(() => (['monthly', 'yearly'])),
  cycleDiscounts: json('cycle_discounts').$default(() => ({})),
  trialDays: int('trial_days').default(0),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const resourceLimits = mysqlTable('resource_limits', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 }).references(() => accounts.id, { onDelete: 'cascade' }),
  maxCpuPerContainer: int('max_cpu_per_container'),
  maxMemoryPerContainer: int('max_memory_per_container'),
  maxReplicas: int('max_replicas'),
  maxContainers: int('max_containers'),
  maxStorageGb: int('max_storage_gb'),
  maxBandwidthGb: int('max_bandwidth_gb'),
  maxNfsStorageGb: int('max_nfs_storage_gb'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const accountBillingOverrides = mysqlTable('account_billing_overrides', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  discountPercent: int('discount_percent').default(0),
  customPriceCents: int('custom_price_cents'),
  notes: text('notes'),
  cpuCentsPerHourOverride: int('cpu_cents_per_hour_override'),
  memoryCentsPerGbHourOverride: int('memory_cents_per_gb_hour_override'),
  storageCentsPerGbMonthOverride: int('storage_cents_per_gb_month_override'),
  bandwidthCentsPerGbOverride: int('bandwidth_cents_per_gb_override'),
  containerCentsPerHourOverride: int('container_cents_per_hour_override'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const webhookEvents = mysqlTable('webhook_events', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  stripeEventId: varchar('stripe_event_id', { length: 255 }).unique().notNull(),
  eventType: varchar('event_type', { length: 255 }).notNull(),
  processedAt: timestamp('processed_at').defaultNow(),
  payload: json('payload').$type<Record<string, unknown> | null>(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const billingPlansRelations = relations(
  billingPlans,
  ({ many }) => ({
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

export const resourceLimitsRelations = relations(resourceLimits, ({ one }) => ({
  account: one(accounts, {
    fields: [resourceLimits.accountId],
    references: [accounts.id],
  }),
}));

export const accountBillingOverridesRelations = relations(accountBillingOverrides, ({ one }) => ({
  account: one(accounts, {
    fields: [accountBillingOverrides.accountId],
    references: [accounts.id],
  }),
}));
