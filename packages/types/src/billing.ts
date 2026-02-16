// ---------------------------------------------------------------------------
// Billing & Subscription types
// ---------------------------------------------------------------------------

export type SubscriptionStatus = 'active' | 'past_due' | 'cancelled';

export interface PricingConfig {
  containerFee: number;
  cpuFee: number;
  memoryFee: number;
  storageFee: number;
  bandwidthFee: number;
  domainMarkupPercent: number;
  backupStorageFee: number;
}

export interface BillingPlan {
  id: string;
  accountId: string;
  name: string;
  stripePriceId: string | null;
  cpuLimit: number;
  memoryLimit: number;
  containerLimit: number;
  storageLimit: number;
  priceCents: number;
}

export interface Subscription {
  id: string;
  accountId: string;
  planId: string;
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
}

export interface UsageRecord {
  id: string;
  accountId: string;
  containers: number;
  cpuSeconds: number;
  memoryMbHours: number;
  storageGb: number;
  recordedAt: Date;
}

export interface CreateCheckoutInput {
  accountId: string;
  planId: string;
  successUrl: string;
  cancelUrl: string;
}
