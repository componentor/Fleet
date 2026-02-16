// ---------------------------------------------------------------------------
// Account types
// ---------------------------------------------------------------------------

import type { PricingConfig } from './billing.js';

export type AccountStatus = 'active' | 'suspended' | 'pending';

export interface AccountPlan {
  cpuLimit: number;
  memoryLimit: number;
  containerLimit: number;
  storageLimit: number;
  pricingConfig: PricingConfig;
}

export interface Account {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  path: string;
  depth: number;
  trustRevocable: boolean;
  stripeCustomerId: string | null;
  stripeConnectAccountId: string | null;
  plan: AccountPlan | null;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountTree {
  account: Account;
  children: AccountTree[];
}

export interface CreateAccountInput {
  name: string;
  slug: string;
  parentId?: string;
  plan?: AccountPlan;
}

export interface UpdateAccountInput {
  name?: string;
  slug?: string;
  parentId?: string | null;
  trustRevocable?: boolean;
  stripeCustomerId?: string | null;
  stripeConnectAccountId?: string | null;
  plan?: AccountPlan | null;
  status?: AccountStatus;
}
