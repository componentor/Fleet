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
  index,
  uniqueIndex,
} from 'drizzle-orm/mysql-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { stacks } from './stacks';

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
  maxUsersPerAccount: int('max_users_per_account'),
  priceCents: int('price_cents').notNull(),
  yearlyPriceCents: int('yearly_price_cents'),
  stripeProductId: varchar('stripe_product_id', { length: 255 }),
  stripePriceIds: json('stripe_price_ids').$default(() => ({})),
  nameTranslations: json('name_translations').$default(() => ({})),
  descriptionTranslations: json('description_translations').$default(() => ({})),
  scope: varchar('scope', { length: 255 }).default('service'),
  volumeIncludedGb: int('volume_included_gb').default(0),
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
  serviceId: varchar('service_id', { length: 36 }),
  stackId: varchar('stack_id', { length: 36 })
    .references(() => stacks.id, { onDelete: 'set null' }),
  paymentContactName: varchar('payment_contact_name', { length: 255 }),
  paymentContactEmail: varchar('payment_contact_email', { length: 255 }),
  pastDueSince: timestamp('past_due_since'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_subscriptions_account_id').on(table.accountId),
  index('idx_subscriptions_status').on(table.status),
  index('idx_subscriptions_past_due_since').on(table.pastDueSince),
  index('idx_subscriptions_service_id').on(table.serviceId),
  index('idx_subscriptions_stack_id').on(table.stackId),
]);

export const usageRecords = mysqlTable('usage_records', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
  containers: int('containers').default(0),
  cpuSeconds: bigint('cpu_seconds', { mode: 'number' }).default(sql`0`),
  memoryMbHours: bigint('memory_mb_hours', { mode: 'number' }).default(sql`0`),
  storageGb: int('storage_gb').default(0),
  bandwidthGb: int('bandwidth_gb').default(0),
  serviceId: varchar('service_id', { length: 36 }),
  stackId: varchar('stack_id', { length: 36 }),
  recordedAt: timestamp('recorded_at').defaultNow(),
}, (table) => [
  index('idx_usage_records_account_id').on(table.accountId),
  index('idx_usage_records_service_id').on(table.serviceId),
  index('idx_usage_records_stack_id').on(table.stackId),
]);

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
  suspensionGraceDays: int('suspension_grace_days').default(7),
  deletionGraceDays: int('deletion_grace_days').default(14),
  autoSuspendEnabled: boolean('auto_suspend_enabled').default(true),
  autoDeleteEnabled: boolean('auto_delete_enabled').default(false),
  suspensionWarningDays: int('suspension_warning_days').default(2),
  deletionWarningDays: int('deletion_warning_days').default(7),
  volumeDeletionEnabled: boolean('volume_deletion_enabled').default(true),
  purgeEnabled: boolean('purge_enabled').default(true),
  purgeRetentionDays: int('purge_retention_days').default(30),
  allowDowngrade: boolean('allow_downgrade').default(true),
  deletionBillingPolicy: varchar('deletion_billing_policy', { length: 20 }).default('end_of_period').notNull(),
  maxFreeServicesPerAccount: int('max_free_services_per_account'),
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
  maxContainerDiskMb: int('max_container_disk_mb'),
  maxTotalCpuCores: int('max_total_cpu_cores'),
  maxTotalMemoryMb: int('max_total_memory_mb'),
  maxBackupStorageGb: int('max_backup_storage_gb'), // Separate backup quota
  backupClusterId: varchar('backup_cluster_id', { length: 36 }), // Account-level backup cluster override
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_resource_limits_account_id').on(table.accountId),
]);

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
  maxFreeServices: int('max_free_services'),
  freeTierCpuLimit: int('free_tier_cpu_limit'),
  freeTierMemoryLimit: int('free_tier_memory_limit'),
  freeTierContainerLimit: int('free_tier_container_limit'),
  freeTierStorageLimit: int('free_tier_storage_limit'),
  boostCpuLimit: int('boost_cpu_limit'),
  boostMemoryLimit: int('boost_memory_limit'),
  boostContainerLimit: int('boost_container_limit'),
  boostStorageLimit: int('boost_storage_limit'),
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

export const billingPlanPrices = mysqlTable('billing_plan_prices', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  planId: varchar('plan_id', { length: 36 })
    .references(() => billingPlans.id, { onDelete: 'cascade' })
    .notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  priceCents: int('price_cents').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  uniqueIndex('idx_billing_plan_prices_plan_currency').on(table.planId, table.currency),
]);

export const billingPlansRelations = relations(
  billingPlans,
  ({ many }) => ({
    subscriptions: many(subscriptions),
    prices: many(billingPlanPrices),
  }),
);

export const billingPlanPricesRelations = relations(billingPlanPrices, ({ one }) => ({
  plan: one(billingPlans, {
    fields: [billingPlanPrices.planId],
    references: [billingPlans.id],
  }),
}));

export const subscriptionsRelations = relations(subscriptions, ({ one }) => ({
  account: one(accounts, {
    fields: [subscriptions.accountId],
    references: [accounts.id],
  }),
  plan: one(billingPlans, {
    fields: [subscriptions.planId],
    references: [billingPlans.id],
  }),
  stack: one(stacks, {
    fields: [subscriptions.stackId],
    references: [stacks.id],
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

// ── Reseller tables ──────────────────────────────────────────────────────────

export const resellerConfig = mysqlTable('reseller_config', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  enabled: boolean('enabled').default(false),
  approvalMode: varchar('approval_mode', { length: 255 }).default('manual'),
  allowSubAccountReselling: boolean('allow_sub_account_reselling').default(false),
  defaultDiscountType: varchar('default_discount_type', { length: 255 }).default('percentage'),
  defaultDiscountPercent: int('default_discount_percent').default(0),
  defaultDiscountFixed: int('default_discount_fixed').default(0),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const resellerAccounts = mysqlTable('reseller_accounts', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  status: varchar('status', { length: 255 }).default('pending'),
  stripeConnectId: varchar('stripe_connect_id', { length: 255 }),
  connectOnboarded: boolean('connect_onboarded').default(false),
  discountType: varchar('discount_type', { length: 255 }),
  discountPercent: int('discount_percent'),
  discountFixed: int('discount_fixed'),
  markupType: varchar('markup_type', { length: 255 }).default('percentage'),
  markupPercent: int('markup_percent').default(0),
  markupFixed: int('markup_fixed').default(0),
  canSubAccountResell: boolean('can_sub_account_resell').default(false),
  signupSlug: varchar('signup_slug', { length: 255 }).unique(),
  customDomain: varchar('custom_domain', { length: 255 }),
  brandName: varchar('brand_name', { length: 255 }),
  brandLogoUrl: varchar('brand_logo_url', { length: 1024 }),
  brandPrimaryColor: varchar('brand_primary_color', { length: 20 }),
  brandDescription: text('brand_description'),
  approvedAt: timestamp('approved_at'),
  approvedBy: varchar('approved_by', { length: 36 }),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_reseller_accounts_status').on(table.status),
]);

export const resellerApplications = mysqlTable('reseller_applications', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: varchar('account_id', { length: 36 })
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  message: text('message'),
  status: varchar('status', { length: 255 }).default('pending'),
  reviewedBy: varchar('reviewed_by', { length: 36 }),
  reviewedAt: timestamp('reviewed_at'),
  reviewNote: text('review_note'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_reseller_applications_account_id').on(table.accountId),
  index('idx_reseller_applications_status').on(table.status),
]);

export const resellerAccountsRelations = relations(resellerAccounts, ({ one }) => ({
  account: one(accounts, {
    fields: [resellerAccounts.accountId],
    references: [accounts.id],
  }),
}));

export const resellerApplicationsRelations = relations(resellerApplications, ({ one }) => ({
  account: one(accounts, {
    fields: [resellerApplications.accountId],
    references: [accounts.id],
  }),
}));
