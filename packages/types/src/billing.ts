// ---------------------------------------------------------------------------
// Billing & Subscription types
// ---------------------------------------------------------------------------

export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled' | 'trialing' | 'incomplete';

export type BillingModel = 'fixed' | 'usage' | 'hybrid';

export type BillingCycle = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

export interface CycleDiscount {
  type: 'fixed' | 'percentage';
  value: number;
}

export interface BillingConfig {
  billingModel: BillingModel;
  allowUserChoice: boolean;
  allowedCycles: BillingCycle[];
  cycleDiscounts: Partial<Record<BillingCycle, CycleDiscount>>;
  trialDays: number;
}

export interface PricingConfig {
  cpuCentsPerHour: number;
  memoryCentsPerGbHour: number;
  storageCentsPerGbMonth: number;
  bandwidthCentsPerGb: number;
  containerCentsPerHour: number;
  domainMarkupPercent: number;
  backupStorageCentsPerGb: number;
  locationPricingEnabled: boolean;
}

export interface LocationMultiplier {
  id: string;
  locationKey: string;
  label: string;
  multiplier: number;
  createdAt: Date;
}

export interface BillingPlan {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sortOrder: number;
  isDefault: boolean;
  isFree: boolean;
  visible: boolean;
  cpuLimit: number;
  memoryLimit: number;
  containerLimit: number;
  storageLimit: number;
  bandwidthLimit: number | null;
  priceCents: number;
  stripeProductId: string | null;
  stripePriceIds: Record<string, string>;
  nameTranslations: Record<string, string>;
  descriptionTranslations: Record<string, string>;
  scope: 'service' | 'stack';
  volumeIncludedGb: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillingPlanPrice {
  id: string;
  planId: string;
  currency: string;
  priceCents: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Subscription {
  id: string;
  accountId: string;
  planId: string | null;
  billingModel: BillingModel;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  billingCycle: BillingCycle;
  status: SubscriptionStatus;
  serviceId: string | null;
  stackId: string | null;
  paymentContactName: string | null;
  paymentContactEmail: string | null;
  trialEndsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  plan?: BillingPlan;
}

export interface UsageRecord {
  id: string;
  accountId: string;
  periodStart: Date | null;
  periodEnd: Date | null;
  containers: number;
  cpuSeconds: number;
  memoryMbHours: number;
  storageGb: number;
  bandwidthGb: number;
  recordedAt: Date;
}

export interface UsageSummary {
  containers: number;
  cpuHours: number;
  memoryGbHours: number;
  storageGb: number;
  bandwidthGb: number;
  estimatedCostCents: number;
  breakdown: {
    cpuCents: number;
    memoryCents: number;
    storageCents: number;
    bandwidthCents: number;
    containerCents: number;
  };
  periodStart: Date | null;
  periodEnd: Date | null;
}

export interface ResourceLimits {
  id: string;
  accountId: string | null;
  maxCpuPerContainer: number | null;
  maxMemoryPerContainer: number | null;
  maxReplicas: number | null;
  maxContainers: number | null;
  maxStorageGb: number | null;
  maxBandwidthGb: number | null;
  maxNfsStorageGb: number | null;
}

export interface AccountBillingOverride {
  id: string;
  accountId: string;
  discountPercent: number;
  customPriceCents: number | null;
  notes: string | null;
  cpuCentsPerHourOverride: number | null;
  memoryCentsPerGbHourOverride: number | null;
  storageCentsPerGbMonthOverride: number | null;
  bandwidthCentsPerGbOverride: number | null;
  containerCentsPerHourOverride: number | null;
}

export interface CreateCheckoutInput {
  accountId: string;
  billingModel: BillingModel;
  billingCycle: BillingCycle;
  planId?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateServiceCheckoutInput {
  accountId: string;
  serviceId?: string;
  stackId?: string;
  planId: string;
  billingCycle: BillingCycle;
  currency?: string;
  paymentMethodId?: string;
  billingContactEmail?: string;
  billingContactName?: string;
  successUrl: string;
  cancelUrl: string;
}

export interface Stack {
  id: string;
  accountId: string;
  name: string | null;
  templateSlug: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}
