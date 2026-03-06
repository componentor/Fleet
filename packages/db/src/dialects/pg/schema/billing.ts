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
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import { accounts } from './accounts';
import { stacks } from './stacks';

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
  maxUsersPerAccount: integer('max_users_per_account'),
  priceCents: integer('price_cents').notNull(),
  yearlyPriceCents: integer('yearly_price_cents'),
  stripeProductId: varchar('stripe_product_id'),
  stripePriceIds: jsonb('stripe_price_ids').default({}),
  nameTranslations: jsonb('name_translations').default({}),
  descriptionTranslations: jsonb('description_translations').default({}),
  scope: varchar('scope').default('service'),
  volumeIncludedGb: integer('volume_included_gb').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const subscriptions = pgTable('subscriptions', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  planId: uuid('plan_id')
    .references(() => billingPlans.id, { onDelete: 'set null' }),
  billingModel: varchar('billing_model').default('fixed'),
  stripeSubscriptionId: varchar('stripe_subscription_id').unique(),
  stripeCustomerId: varchar('stripe_customer_id'),
  billingCycle: varchar('billing_cycle').default('monthly'),
  status: varchar('status').default('active'),
  trialEndsAt: timestamp('trial_ends_at'),
  currentPeriodStart: timestamp('current_period_start'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelledAt: timestamp('cancelled_at'),
  serviceId: uuid('service_id'),
  stackId: uuid('stack_id')
    .references(() => stacks.id, { onDelete: 'set null' }),
  paymentContactName: varchar('payment_contact_name'),
  paymentContactEmail: varchar('payment_contact_email'),
  billedByAccountId: uuid('billed_by_account_id')
    .references(() => accounts.id, { onDelete: 'set null' }),
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

export const usageRecords = pgTable('usage_records', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
  containers: integer('containers').default(0),
  cpuSeconds: bigint('cpu_seconds', { mode: 'number' }).default(sql`0`),
  memoryMbHours: bigint('memory_mb_hours', { mode: 'number' }).default(sql`0`),
  storageGb: integer('storage_gb').default(0),
  bandwidthGb: integer('bandwidth_gb').default(0),
  serviceId: uuid('service_id'),
  stackId: uuid('stack_id'),
  recordedAt: timestamp('recorded_at').defaultNow(),
}, (table) => [
  index('idx_usage_records_account_id').on(table.accountId),
  index('idx_usage_records_service_id').on(table.serviceId),
  index('idx_usage_records_stack_id').on(table.stackId),
]);

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
  suspensionGraceDays: integer('suspension_grace_days').default(7),
  deletionGraceDays: integer('deletion_grace_days').default(14),
  autoSuspendEnabled: boolean('auto_suspend_enabled').default(true),
  autoDeleteEnabled: boolean('auto_delete_enabled').default(false),
  suspensionWarningDays: integer('suspension_warning_days').default(2),
  deletionWarningDays: integer('deletion_warning_days').default(7),
  volumeDeletionEnabled: boolean('volume_deletion_enabled').default(true),
  purgeEnabled: boolean('purge_enabled').default(true),
  purgeRetentionDays: integer('purge_retention_days').default(30),
  allowDowngrade: boolean('allow_downgrade').default(true),
  deletionBillingPolicy: varchar('deletion_billing_policy').default('end_of_period').notNull(),
  maxFreeServicesPerAccount: integer('max_free_services_per_account'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const resourceLimits = pgTable('resource_limits', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  maxCpuPerContainer: integer('max_cpu_per_container'),
  maxMemoryPerContainer: integer('max_memory_per_container'),
  maxReplicas: integer('max_replicas'),
  maxContainers: integer('max_containers'),
  maxStorageGb: integer('max_storage_gb'),
  maxBandwidthGb: integer('max_bandwidth_gb'),
  maxNfsStorageGb: integer('max_nfs_storage_gb'),
  maxContainerDiskMb: integer('max_container_disk_mb'),
  maxTotalCpuCores: integer('max_total_cpu_cores'),
  maxTotalMemoryMb: integer('max_total_memory_mb'),
  maxBackupStorageGb: integer('max_backup_storage_gb'), // Separate backup quota
  backupClusterId: uuid('backup_cluster_id'), // Account-level backup cluster override
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_resource_limits_account_id').on(table.accountId),
]);

export const accountBillingOverrides = pgTable('account_billing_overrides', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
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
  maxFreeServices: integer('max_free_services'),
  freeTierCpuLimit: integer('free_tier_cpu_limit'),
  freeTierMemoryLimit: integer('free_tier_memory_limit'),
  freeTierContainerLimit: integer('free_tier_container_limit'),
  freeTierStorageLimit: integer('free_tier_storage_limit'),
  boostCpuLimit: integer('boost_cpu_limit'),
  boostMemoryLimit: integer('boost_memory_limit'),
  boostContainerLimit: integer('boost_container_limit'),
  boostStorageLimit: integer('boost_storage_limit'),
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

export const billingPlanPrices = pgTable('billing_plan_prices', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  planId: uuid('plan_id')
    .references(() => billingPlans.id, { onDelete: 'cascade' })
    .notNull(),
  currency: varchar('currency', { length: 3 }).notNull(),
  priceCents: integer('price_cents').notNull(),
  cycle: varchar('cycle', { length: 20 }).notNull().default('monthly'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  uniqueIndex('idx_billing_plan_prices_plan_currency_cycle').on(table.planId, table.currency, table.cycle),
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
    relationName: 'subscription_account',
  }),
  billedByAccount: one(accounts, {
    fields: [subscriptions.billedByAccountId],
    references: [accounts.id],
    relationName: 'subscription_billedBy',
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

export const resellerConfig = pgTable('reseller_config', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  enabled: boolean('enabled').default(false),
  approvalMode: varchar('approval_mode').default('manual'),
  allowSubAccountReselling: boolean('allow_sub_account_reselling').default(false),
  defaultDiscountType: varchar('default_discount_type').default('percentage'),
  defaultDiscountPercent: integer('default_discount_percent').default(0),
  defaultDiscountFixed: integer('default_discount_fixed').default(0),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const resellerAccounts = pgTable('reseller_accounts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  status: varchar('status').default('pending'),
  stripeConnectId: varchar('stripe_connect_id'),
  connectOnboarded: boolean('connect_onboarded').default(false),
  discountType: varchar('discount_type'),
  discountPercent: integer('discount_percent'),
  discountFixed: integer('discount_fixed'),
  markupType: varchar('markup_type').default('percentage'),
  markupPercent: integer('markup_percent').default(0),
  markupFixed: integer('markup_fixed').default(0),
  canSubAccountResell: boolean('can_sub_account_resell').default(false),
  signupSlug: varchar('signup_slug').unique(),
  customDomain: varchar('custom_domain'),
  customDomainVerified: boolean('custom_domain_verified').default(false),
  customDomainToken: varchar('custom_domain_token'),
  brandName: varchar('brand_name'),
  brandLogoUrl: varchar('brand_logo_url'),
  brandPrimaryColor: varchar('brand_primary_color'),
  brandDescription: text('brand_description'),
  approvedAt: timestamp('approved_at'),
  approvedBy: uuid('approved_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_reseller_accounts_status').on(table.status),
]);

export const resellerApplications = pgTable('reseller_applications', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  accountId: uuid('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  message: text('message'),
  status: varchar('status').default('pending'),
  reviewedBy: uuid('reviewed_by'),
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
