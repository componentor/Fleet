import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  integer,
  bigint,
  jsonb,
  timestamp,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';

export const billingPlans = pgTable('billing_plans', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  name: varchar('name').notNull(),
  slug: varchar('slug').unique().notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0),
  isDefault: boolean('is_default').default(false),
  isFree: boolean('is_free').default(false),
  visible: boolean('visible').default(true),
  cpuLimit: integer('cpu_limit').notNull(),
  memoryLimit: integer('memory_limit').notNull(),
  containerLimit: integer('container_limit').notNull(),
  storageLimit: integer('storage_limit').notNull(),
  bandwidthLimit: integer('bandwidth_limit'),
  priceCents: integer('price_cents').notNull(),
  stripeProductId: varchar('stripe_product_id'),
  stripePriceIds: jsonb('stripe_price_ids').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  planId: uuid('plan_id')
    .references(() => billingPlans.id),
  billingModel: varchar('billing_model').default('fixed'),
  stripeSubscriptionId: varchar('stripe_subscription_id'),
  stripeCustomerId: varchar('stripe_customer_id'),
  billingCycle: varchar('billing_cycle').default('monthly'),
  status: varchar('status').default('active'),
  trialEndsAt: timestamp('trial_ends_at'),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id)
    .notNull(),
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
  containers: integer('containers').default(0),
  cpuSeconds: bigint('cpu_seconds', { mode: 'bigint' }).default(sql`0`),
  memoryMbHours: bigint('memory_mb_hours', { mode: 'bigint' }).default(sql`0`),
  storageGb: integer('storage_gb').default(0),
  bandwidthGb: integer('bandwidth_gb').default(0),
  recordedAt: timestamp('recorded_at').defaultNow(),
});

export const pricingConfig = pgTable('pricing_config', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  cpuCentsPerHour: integer('cpu_cents_per_hour').default(0),
  memoryCentsPerGbHour: integer('memory_cents_per_gb_hour').default(0),
  storageCentsPerGbMonth: integer('storage_cents_per_gb_month').default(0),
  bandwidthCentsPerGb: integer('bandwidth_cents_per_gb').default(0),
  containerCentsPerHour: integer('container_cents_per_hour').default(0),
  domainMarkupPercent: integer('domain_markup_percent').default(0),
  backupStorageCentsPerGb: integer('backup_storage_cents_per_gb').default(0),
  locationPricingEnabled: boolean('location_pricing_enabled').default(false),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const locationMultipliers = pgTable('location_multipliers', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  locationKey: varchar('location_key').unique().notNull(),
  label: varchar('label').notNull(),
  multiplier: integer('multiplier').default(100),
  createdAt: timestamp('created_at').defaultNow(),
});

export const billingConfig = pgTable('billing_config', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  billingModel: varchar('billing_model').default('fixed').notNull(),
  allowUserChoice: boolean('allow_user_choice').default(false),
  allowedCycles: jsonb('allowed_cycles').default(['monthly', 'yearly']),
  cycleDiscounts: jsonb('cycle_discounts').default({}),
  trialDays: integer('trial_days').default(0),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const resourceLimits = pgTable('resource_limits', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id').references(() => accounts.id),
  maxCpuPerContainer: integer('max_cpu_per_container'),
  maxMemoryPerContainer: integer('max_memory_per_container'),
  maxReplicas: integer('max_replicas'),
  maxContainers: integer('max_containers'),
  maxStorageGb: integer('max_storage_gb'),
  maxBandwidthGb: integer('max_bandwidth_gb'),
  maxNfsStorageGb: integer('max_nfs_storage_gb'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const accountBillingOverrides = pgTable('account_billing_overrides', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id)
    .notNull()
    .unique(),
  discountPercent: integer('discount_percent').default(0),
  customPriceCents: integer('custom_price_cents'),
  notes: text('notes'),
  cpuCentsPerHourOverride: integer('cpu_cents_per_hour_override'),
  memoryCentsPerGbHourOverride: integer('memory_cents_per_gb_hour_override'),
  storageCentsPerGbMonthOverride: integer('storage_cents_per_gb_month_override'),
  bandwidthCentsPerGbOverride: integer('bandwidth_cents_per_gb_override'),
  containerCentsPerHourOverride: integer('container_cents_per_hour_override'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  stripeEventId: varchar('stripe_event_id').unique().notNull(),
  eventType: varchar('event_type').notNull(),
  processedAt: timestamp('processed_at').defaultNow(),
  payload: jsonb('payload').$type<Record<string, unknown> | null>(),
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
