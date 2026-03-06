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
import { stacks } from './stacks';

export const billingPlans = sqliteTable('billing_plans', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').default(0),
  isDefault: integer('is_default', { mode: 'boolean' }).default(false),
  isFree: integer('is_free', { mode: 'boolean' }).default(false),
  visible: integer('visible', { mode: 'boolean' }).default(true),
  cpuLimit: integer('cpu_limit').notNull(),
  memoryLimit: integer('memory_limit').notNull(),
  containerLimit: integer('container_limit').notNull(),
  storageLimit: integer('storage_limit').notNull(),
  bandwidthLimit: integer('bandwidth_limit'),
  maxUsersPerAccount: integer('max_users_per_account'),
  priceCents: integer('price_cents').notNull(),
  stripeProductId: text('stripe_product_id'),
  stripePriceIds: text('stripe_price_ids', { mode: 'json' }).$default(() => ({})),
  nameTranslations: text('name_translations', { mode: 'json' }).$default(() => ({})),
  descriptionTranslations: text('description_translations', { mode: 'json' }).$default(() => ({})),
  scope: text('scope').default('service'),
  volumeIncludedGb: integer('volume_included_gb').default(0),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  planId: text('plan_id')
    .references(() => billingPlans.id, { onDelete: 'set null' }),
  billingModel: text('billing_model').default('fixed'),
  stripeSubscriptionId: text('stripe_subscription_id').unique(),
  stripeCustomerId: text('stripe_customer_id'),
  billingCycle: text('billing_cycle').default('monthly'),
  status: text('status').default('active'),
  trialEndsAt: integer('trial_ends_at', { mode: 'timestamp' }),
  currentPeriodStart: integer('current_period_start', { mode: 'timestamp' }),
  currentPeriodEnd: integer('current_period_end', { mode: 'timestamp' }),
  cancelledAt: integer('cancelled_at', { mode: 'timestamp' }),
  serviceId: text('service_id'),
  stackId: text('stack_id')
    .references(() => stacks.id, { onDelete: 'set null' }),
  paymentContactName: text('payment_contact_name'),
  paymentContactEmail: text('payment_contact_email'),
  billedByAccountId: text('billed_by_account_id')
    .references(() => accounts.id, { onDelete: 'set null' }),
  pastDueSince: integer('past_due_since', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_subscriptions_account_id').on(table.accountId),
  index('idx_subscriptions_status').on(table.status),
  index('idx_subscriptions_past_due_since').on(table.pastDueSince),
  index('idx_subscriptions_service_id').on(table.serviceId),
  index('idx_subscriptions_stack_id').on(table.stackId),
]);

export const usageRecords = sqliteTable('usage_records', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  periodStart: integer('period_start', { mode: 'timestamp' }),
  periodEnd: integer('period_end', { mode: 'timestamp' }),
  containers: integer('containers').default(0),
  cpuSeconds: integer('cpu_seconds', { mode: 'number' }).default(0),
  memoryMbHours: integer('memory_mb_hours', { mode: 'number' }).default(0),
  storageGb: integer('storage_gb').default(0),
  bandwidthGb: integer('bandwidth_gb').default(0),
  serviceId: text('service_id'),
  stackId: text('stack_id'),
  recordedAt: integer('recorded_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_usage_records_account_id').on(table.accountId),
  index('idx_usage_records_service_id').on(table.serviceId),
  index('idx_usage_records_stack_id').on(table.stackId),
]);

export const pricingConfig = sqliteTable('pricing_config', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  cpuCentsPerHour: integer('cpu_cents_per_hour').default(0),
  memoryCentsPerGbHour: integer('memory_cents_per_gb_hour').default(0),
  storageCentsPerGbMonth: integer('storage_cents_per_gb_month').default(0),
  bandwidthCentsPerGb: integer('bandwidth_cents_per_gb').default(0),
  containerCentsPerHour: integer('container_cents_per_hour').default(0),
  domainMarkupPercent: integer('domain_markup_percent').default(0),
  backupStorageCentsPerGb: integer('backup_storage_cents_per_gb').default(0),
  locationPricingEnabled: integer('location_pricing_enabled', { mode: 'boolean' }).default(false),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const locationMultipliers = sqliteTable('location_multipliers', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  locationKey: text('location_key').unique().notNull(),
  label: text('label').notNull(),
  multiplier: integer('multiplier').default(100),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const billingConfig = sqliteTable('billing_config', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  billingModel: text('billing_model').default('fixed').notNull(),
  allowUserChoice: integer('allow_user_choice', { mode: 'boolean' }).default(false),
  allowedCycles: text('allowed_cycles', { mode: 'json' }).$default(() => (['monthly', 'yearly'])),
  cycleDiscounts: text('cycle_discounts', { mode: 'json' }).$default(() => ({})),
  trialDays: integer('trial_days').default(0),
  suspensionGraceDays: integer('suspension_grace_days').default(7),
  deletionGraceDays: integer('deletion_grace_days').default(14),
  autoSuspendEnabled: integer('auto_suspend_enabled', { mode: 'boolean' }).default(true),
  autoDeleteEnabled: integer('auto_delete_enabled', { mode: 'boolean' }).default(false),
  suspensionWarningDays: integer('suspension_warning_days').default(2),
  deletionWarningDays: integer('deletion_warning_days').default(7),
  volumeDeletionEnabled: integer('volume_deletion_enabled', { mode: 'boolean' }).default(true),
  purgeEnabled: integer('purge_enabled', { mode: 'boolean' }).default(true),
  purgeRetentionDays: integer('purge_retention_days').default(30),
  allowDowngrade: integer('allow_downgrade', { mode: 'boolean' }).default(true),
  deletionBillingPolicy: text('deletion_billing_policy').default('end_of_period').notNull(),
  maxFreeServicesPerAccount: integer('max_free_services_per_account'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Global resource limits (account_id NULL = global default, set = per-account override)
export const resourceLimits = sqliteTable('resource_limits', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id').references(() => accounts.id, { onDelete: 'cascade' }),
  maxCpuPerContainer: integer('max_cpu_per_container'), // millicores
  maxMemoryPerContainer: integer('max_memory_per_container'), // MB
  maxReplicas: integer('max_replicas'),
  maxContainers: integer('max_containers'),
  maxStorageGb: integer('max_storage_gb'),
  maxBandwidthGb: integer('max_bandwidth_gb'),
  maxNfsStorageGb: integer('max_nfs_storage_gb'),
  maxContainerDiskMb: integer('max_container_disk_mb'),
  maxTotalCpuCores: integer('max_total_cpu_cores'),
  maxTotalMemoryMb: integer('max_total_memory_mb'),
  maxBackupStorageGb: integer('max_backup_storage_gb'), // Separate backup quota
  backupClusterId: text('backup_cluster_id'), // Account-level backup cluster override
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_resource_limits_account_id').on(table.accountId),
]);

// Per-account billing overrides (discounts, custom pricing, plan overrides)
export const accountBillingOverrides = sqliteTable('account_billing_overrides', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  discountPercent: integer('discount_percent').default(0), // global discount %
  customPriceCents: integer('custom_price_cents'), // override plan price
  notes: text('notes'), // admin notes about this override
  cpuCentsPerHourOverride: integer('cpu_cents_per_hour_override'),
  memoryCentsPerGbHourOverride: integer('memory_cents_per_gb_hour_override'),
  storageCentsPerGbMonthOverride: integer('storage_cents_per_gb_month_override'),
  bandwidthCentsPerGbOverride: integer('bandwidth_cents_per_gb_override'),
  containerCentsPerHourOverride: integer('container_cents_per_hour_override'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const webhookEvents = sqliteTable('webhook_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  stripeEventId: text('stripe_event_id').unique().notNull(),
  eventType: text('event_type').notNull(),
  processedAt: integer('processed_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  payload: text('payload', { mode: 'json' }).$type<Record<string, unknown> | null>(),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
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

export const resellerConfig = sqliteTable('reseller_config', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  enabled: integer('enabled', { mode: 'boolean' }).default(false),
  approvalMode: text('approval_mode').default('manual'),
  allowSubAccountReselling: integer('allow_sub_account_reselling', { mode: 'boolean' }).default(false),
  defaultDiscountType: text('default_discount_type').default('percentage'),
  defaultDiscountPercent: integer('default_discount_percent').default(0),
  defaultDiscountFixed: integer('default_discount_fixed').default(0),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

export const resellerAccounts = sqliteTable('reseller_accounts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  status: text('status').default('pending'),
  stripeConnectId: text('stripe_connect_id'),
  connectOnboarded: integer('connect_onboarded', { mode: 'boolean' }).default(false),
  discountType: text('discount_type'),
  discountPercent: integer('discount_percent'),
  discountFixed: integer('discount_fixed'),
  markupType: text('markup_type').default('percentage'),
  markupPercent: integer('markup_percent').default(0),
  markupFixed: integer('markup_fixed').default(0),
  canSubAccountResell: integer('can_sub_account_resell', { mode: 'boolean' }).default(false),
  signupSlug: text('signup_slug').unique(),
  customDomain: text('custom_domain'),
  brandName: text('brand_name'),
  brandLogoUrl: text('brand_logo_url'),
  brandPrimaryColor: text('brand_primary_color'),
  brandDescription: text('brand_description'),
  approvedAt: integer('approved_at', { mode: 'timestamp' }),
  approvedBy: text('approved_by'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
}, (table) => [
  index('idx_reseller_accounts_status').on(table.status),
]);

export const resellerApplications = sqliteTable('reseller_applications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accountId: text('account_id')
    .references(() => accounts.id, { onDelete: 'cascade' })
    .notNull(),
  message: text('message'),
  status: text('status').default('pending'),
  reviewedBy: text('reviewed_by'),
  reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
  reviewNote: text('review_note'),
  createdAt: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
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
