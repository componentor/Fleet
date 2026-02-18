import { Hono } from 'hono';
import { z } from 'zod';
import {
  db,
  accounts,
  billingPlans,
  subscriptions,
  usageRecords,
  services,
  billingConfig,
  pricingConfig,
  locationMultipliers,
  resourceLimits,
  accountBillingOverrides,
  userAccounts,
  users,
  countSql,
  insertReturning,
  updateReturning,
  eq,
  and,
  isNull,
  webhookEvents,
  safeTransaction,
} from '@fleet/db';
import { authMiddleware, requireScope, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { stripeService } from '../services/stripe.service.js';
import { stripeSyncService } from '../services/stripe-sync.service.js';
import { usageService } from '../services/usage.service.js';
import { dockerService } from '../services/docker.service.js';
import { requireOwner } from '../middleware/rbac.js';
import { logger } from '../services/logger.js';

/** Validate that a redirect URL belongs to the app's origin (prevents open redirects via Stripe). */
function validateRedirectUrl(url: string): boolean {
  const appUrl = process.env['APP_URL'];
  if (!appUrl) return process.env['NODE_ENV'] !== 'production'; // Reject in production if APP_URL not set
  if (url.startsWith('/')) return true; // Relative path
  try {
    const parsed = new URL(url);
    const app = new URL(appUrl);
    return parsed.origin === app.origin;
  } catch {
    return false;
  }
}

type BillingEnv = {
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
};

const billing = new Hono<BillingEnv>();

// ─── Authenticated + tenant-scoped routes ────────────────────────────────────

const authed = new Hono<BillingEnv>();
authed.use('*', authMiddleware);
authed.use('*', tenantMiddleware);

// GET /plans — list all visible billing plans
authed.get('/plans', async (c) => {
  const plans = await db.query.billingPlans.findMany({
    where: eq(billingPlans.visible, true),
    orderBy: (p, { asc }) => asc(p.sortOrder),
  });

  return c.json(plans);
});

// GET /plans/:slug — get a specific plan by slug
authed.get('/plans/:slug', async (c) => {
  const slug = c.req.param('slug');
  const plan = await db.query.billingPlans.findFirst({
    where: and(eq(billingPlans.slug, slug), eq(billingPlans.visible, true)),
  });

  if (!plan) {
    return c.json({ error: 'Plan not found' }, 404);
  }

  return c.json(plan);
});

// POST /checkout — create a Stripe Checkout session
const checkoutSchema = z.object({
  billingModel: z.enum(['fixed', 'usage', 'hybrid']),
  billingCycle: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly']),
  planId: z.string().optional(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

authed.post('/checkout', requireOwner, requireScope('admin'), async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { billingModel, billingCycle, planId, successUrl, cancelUrl } = parsed.data;

  if (billingModel === 'usage' || billingModel === 'hybrid') {
    return c.json({ error: 'Usage-based billing is not yet available. Please select a fixed plan.' }, 400);
  }

  // Validate redirect URLs against APP_URL to prevent open redirects
  if (!validateRedirectUrl(successUrl) || !validateRedirectUrl(cancelUrl)) {
    return c.json({ error: 'Invalid redirect URL: must match application origin' }, 400);
  }

  // Verify billing model is allowed
  const config = await db.query.billingConfig.findFirst();
  if (config && !config.allowUserChoice && billingModel !== config.billingModel) {
    return c.json({ error: 'This billing model is not available' }, 400);
  }

  // Get or create Stripe customer
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
  });
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  let stripeCustomerId = account.stripeCustomerId;
  if (!stripeCustomerId) {
    const user = c.get('user');
    const customer = await stripeService.createCustomer(user.email, account.name ?? user.email);
    stripeCustomerId = customer.id;
    await db.update(accounts).set({ stripeCustomerId, updatedAt: new Date() }).where(eq(accounts.id, accountId));
  }

  try {
    const result = await stripeSyncService.createCheckoutSession({
      accountId,
      billingModel,
      billingCycle,
      planId,
      stripeCustomerId,
      successUrl,
      cancelUrl,
    });
    return c.json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to create checkout session');
    return c.json({ error: 'Checkout failed' }, 400);
  }
});

// GET /subscription — current subscription for the account
authed.get('/subscription', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.accountId, accountId),
    with: { plan: true },
    orderBy: (s, { desc: d }) => d(s.createdAt),
  });

  if (!sub) {
    return c.json(null);
  }

  // Enrich with live Stripe data
  let stripeData = null;
  if (sub.stripeSubscriptionId) {
    try {
      stripeData = await stripeService.getSubscription(sub.stripeSubscriptionId);
    } catch {
      // Stripe may be unavailable
    }
  }

  return c.json({ ...sub, stripeData });
});

// PATCH /subscription/cycle — change billing cycle
const changeCycleSchema = z.object({
  cycle: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly']),
});

authed.patch('/subscription/cycle', requireOwner, requireScope('admin'), async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = changeCycleSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { cycle } = parsed.data;

  const config = await db.query.billingConfig.findFirst();
  const allowedCycles = (config?.allowedCycles ?? ['monthly', 'yearly']) as string[];
  if (!allowedCycles.includes(cycle)) {
    return c.json({ error: 'This billing cycle is not available' }, 400);
  }

  const sub = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.accountId, accountId), eq(subscriptions.status, 'active')),
  });

  if (!sub) {
    return c.json({ error: 'No active subscription found' }, 404);
  }

  await db.update(subscriptions)
    .set({ billingCycle: cycle, updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id));

  return c.json({ message: 'Billing cycle updated', cycle });
});

// DELETE /subscription — cancel subscription at period end
authed.delete('/subscription', requireOwner, requireScope('admin'), async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const sub = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.accountId, accountId), eq(subscriptions.status, 'active')),
  });

  if (!sub) {
    return c.json({ error: 'No active subscription found' }, 404);
  }

  // Cancel in Stripe at period end
  if (sub.stripeSubscriptionId) {
    try {
      await stripeService.cancelSubscriptionAtPeriodEnd(sub.stripeSubscriptionId);
    } catch (err) {
      logger.error({ err }, 'Failed to cancel Stripe subscription');
      return c.json({ error: 'Failed to cancel subscription' }, 500);
    }
  }

  await db.update(subscriptions)
    .set({ cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id));

  // Suspend services immediately — don't wait for webhook
  await suspendAccountServices(accountId);

  return c.json({ message: 'Subscription will cancel at end of billing period' });
});

// GET /usage — usage summary with cost estimates
authed.get('/usage', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const summary = await usageService.getAccountUsageSummary(accountId);

  const [totalCount] = await db
    .select({ count: countSql() })
    .from(services)
    .where(eq(services.accountId, accountId));

  const [runningCount] = await db
    .select({ count: countSql() })
    .from(services)
    .where(and(eq(services.accountId, accountId), eq(services.status, 'running')));

  return c.json({
    ...summary,
    runningContainers: runningCount?.count ?? 0,
    totalContainers: totalCount?.count ?? 0,
  });
});

// GET /usage/history — paginated usage records
authed.get('/usage/history', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const limit = Math.min(Number(c.req.query('limit') ?? 50), 100);
  const offset = Number(c.req.query('offset') ?? 0);

  const records = await db.query.usageRecords.findMany({
    where: eq(usageRecords.accountId, accountId),
    orderBy: (u, { desc: d }) => d(u.recordedAt),
    limit,
    offset,
  });

  return c.json(records);
});

// GET /invoices — invoice history from Stripe
authed.get('/invoices', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
  });

  if (!account?.stripeCustomerId) {
    return c.json([]);
  }

  try {
    const result = await stripeService.listInvoices(account.stripeCustomerId);
    const invoices = result.data.map((inv) => ({
      id: inv.id,
      amount: inv.amount_due,
      currency: inv.currency,
      status: inv.status,
      createdAt: inv.created ? new Date(inv.created * 1000).toISOString() : null,
      pdfUrl: inv.invoice_pdf ?? null,
    }));
    return c.json(invoices);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch invoices from Stripe');
    return c.json({ error: 'Failed to fetch invoices' }, 500);
  }
});

// POST /portal — create a Stripe customer billing portal session
const portalSchema = z.object({
  returnUrl: z.string().url(),
});

authed.post('/portal', requireOwner, async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = portalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  // Validate return URL against APP_URL to prevent open redirects
  if (!validateRedirectUrl(parsed.data.returnUrl)) {
    return c.json({ error: 'Invalid return URL: must match application origin' }, 400);
  }

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
  });

  if (!account?.stripeCustomerId) {
    return c.json({ error: 'No Stripe customer found for this account' }, 400);
  }

  const session = await stripeService.createPortalSession(
    account.stripeCustomerId,
    parsed.data.returnUrl,
  );

  return c.json({ url: session.url });
});

// GET /payment-methods — list payment methods for the account
authed.get('/payment-methods', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
  });

  if (!account?.stripeCustomerId) {
    return c.json({ methods: [], defaultId: null });
  }

  try {
    const [methods, defaultId] = await Promise.all([
      stripeService.listPaymentMethods(account.stripeCustomerId),
      stripeService.getDefaultPaymentMethod(account.stripeCustomerId),
    ]);

    return c.json({
      methods: methods.data.map((pm) => ({
        id: pm.id,
        brand: pm.card?.brand ?? 'unknown',
        last4: pm.card?.last4 ?? '****',
        expMonth: pm.card?.exp_month,
        expYear: pm.card?.exp_year,
      })),
      defaultId,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch payment methods');
    return c.json({ error: 'Failed to fetch payment methods' }, 500);
  }
});

// POST /payment-methods/setup — create a setup intent for adding a new payment method
authed.post('/payment-methods/setup', requireOwner, async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
  });

  if (!account?.stripeCustomerId) {
    return c.json({ error: 'No Stripe customer found' }, 400);
  }

  try {
    const intent = await stripeService.createSetupIntent(account.stripeCustomerId);
    return c.json({ clientSecret: intent.client_secret });
  } catch (err) {
    logger.error({ err }, 'Failed to create setup intent');
    return c.json({ error: 'Failed to create setup intent' }, 500);
  }
});

// PATCH /payment-methods/:id/default — set a payment method as default
authed.patch('/payment-methods/:id/default', requireOwner, async (c) => {
  const accountId = c.get('accountId');
  const paymentMethodId = c.req.param('id');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
  });

  if (!account?.stripeCustomerId) {
    return c.json({ error: 'No Stripe customer found' }, 400);
  }

  try {
    await stripeService.setDefaultPaymentMethod(account.stripeCustomerId, paymentMethodId);
    return c.json({ message: 'Default payment method updated' });
  } catch (err) {
    logger.error({ err }, 'Failed to set default payment method');
    return c.json({ error: 'Failed to update default payment method' }, 500);
  }
});

// DELETE /payment-methods/:id — remove a payment method
authed.delete('/payment-methods/:id', requireOwner, async (c) => {
  const paymentMethodId = c.req.param('id');

  try {
    await stripeService.detachPaymentMethod(paymentMethodId);
    return c.json({ message: 'Payment method removed' });
  } catch (err) {
    logger.error({ err }, 'Failed to detach payment method');
    return c.json({ error: 'Failed to remove payment method' }, 500);
  }
});

// GET /config — billing configuration (public for end users)
authed.get('/config', async (c) => {
  const config = await db.query.billingConfig.findFirst();
  const pricing = await db.query.pricingConfig.findFirst();
  const locations = await db.query.locationMultipliers.findMany();

  return c.json({
    billingModel: config?.billingModel ?? 'fixed',
    allowUserChoice: config?.allowUserChoice ?? false,
    allowedCycles: config?.allowedCycles ?? ['monthly', 'yearly'],
    cycleDiscounts: config?.cycleDiscounts ?? {},
    trialDays: config?.trialDays ?? 0,
    pricingConfig: pricing ? {
      cpuCentsPerHour: pricing.cpuCentsPerHour ?? 0,
      memoryCentsPerGbHour: pricing.memoryCentsPerGbHour ?? 0,
      storageCentsPerGbMonth: pricing.storageCentsPerGbMonth ?? 0,
      bandwidthCentsPerGb: pricing.bandwidthCentsPerGb ?? 0,
      containerCentsPerHour: pricing.containerCentsPerHour ?? 0,
      locationPricingEnabled: pricing.locationPricingEnabled ?? false,
    } : null,
    locations: locations.map((l) => ({
      locationKey: l.locationKey,
      label: l.label,
      multiplier: l.multiplier,
    })),
  });
});

// PATCH /config — update platform billing configuration (super admin only)
const billingConfigSchema = z.object({
  billingModel: z.enum(['fixed', 'usage', 'hybrid']).optional(),
  allowUserChoice: z.boolean().optional(),
  allowedCycles: z.array(z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'])).min(1).optional(),
  cycleDiscounts: z.record(
    z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly']),
    z.object({
      type: z.enum(['fixed', 'percentage']),
      value: z.number().min(0),
    }),
  ).optional(),
  trialDays: z.number().int().min(0).optional(),
});

authed.patch('/config', async (c) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super user access required' }, 403);
  }

  const body = await c.req.json();
  const parsed = billingConfigSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const data = parsed.data;

  if (data.billingModel === 'usage' || data.billingModel === 'hybrid') {
    return c.json({ error: 'Usage-based billing is not yet available. Please select a fixed plan.' }, 400);
  }

  const existing = await db.query.billingConfig.findFirst();

  if (existing) {
    const [updated] = await updateReturning(billingConfig, {
      ...data,
      updatedAt: new Date(),
    }, eq(billingConfig.id, existing.id));
    return c.json(updated);
  }

  const [created] = await insertReturning(billingConfig, {
    billingModel: data.billingModel ?? 'fixed',
    allowUserChoice: data.allowUserChoice ?? false,
    allowedCycles: data.allowedCycles ?? ['monthly', 'yearly'],
    cycleDiscounts: data.cycleDiscounts ?? {},
    trialDays: data.trialDays ?? 0,
  });

  return c.json(created, 201);
});

// GET /price-preview — calculate price for a specific cycle
authed.get('/price-preview', async (c) => {
  const planId = c.req.query('planId');
  const cycle = c.req.query('cycle') as string | undefined;

  if (!planId || !cycle) {
    return c.json({ error: 'planId and cycle are required' }, 400);
  }

  const validCycles = ['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'];
  if (!validCycles.includes(cycle)) {
    return c.json({ error: 'Invalid billing cycle' }, 400);
  }

  const plan = await db.query.billingPlans.findFirst({
    where: eq(billingPlans.id, planId),
  });

  if (!plan) {
    return c.json({ error: 'Plan not found' }, 404);
  }

  const config = await db.query.billingConfig.findFirst();
  const cycleDiscounts = (config?.cycleDiscounts ?? {}) as Record<string, { type: string; value: number }>;

  const monthlyPrice = plan.priceCents;
  const multipliers: Record<string, number> = {
    daily: 1 / 30, weekly: 7 / 30, monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12,
  };

  const multiplier = multipliers[cycle] ?? 1;
  let cyclePriceCents = Math.round(monthlyPrice * multiplier);

  const discount = cycleDiscounts[cycle];
  let discountAmount = 0;
  if (discount) {
    if (discount.type === 'percentage') {
      discountAmount = Math.round(cyclePriceCents * (discount.value / 100));
    } else if (discount.type === 'fixed') {
      discountAmount = discount.value;
    }
    cyclePriceCents = Math.max(0, cyclePriceCents - discountAmount);
  }

  // Apply per-account discount if applicable
  const accountId = c.get('accountId');
  if (accountId) {
    const override = await db.query.accountBillingOverrides.findFirst({
      where: eq(accountBillingOverrides.accountId, accountId),
    });
    if (override?.discountPercent && override.discountPercent > 0) {
      const accountDiscount = Math.round(cyclePriceCents * (override.discountPercent / 100));
      cyclePriceCents = Math.max(0, cyclePriceCents - accountDiscount);
      discountAmount += accountDiscount;
    }
  }

  return c.json({
    planId: plan.id,
    planName: plan.name,
    cycle,
    monthlyPriceCents: monthlyPrice,
    cyclePriceCents,
    discountAmount,
    discount: discount ?? null,
  });
});

// GET /estimate — cost estimate based on current usage for a plan+cycle
authed.get('/estimate', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const billingModel = c.req.query('billingModel') ?? 'fixed';
  const planId = c.req.query('planId');
  const cycle = c.req.query('cycle') ?? 'monthly';

  const usageSummary = await usageService.getAccountUsageSummary(accountId);

  let fixedCostCents = 0;
  if (planId && (billingModel === 'fixed' || billingModel === 'hybrid')) {
    const plan = await db.query.billingPlans.findFirst({
      where: eq(billingPlans.id, planId),
    });
    if (plan) {
      const multipliers: Record<string, number> = {
        daily: 1 / 30, weekly: 7 / 30, monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12,
      };
      fixedCostCents = Math.round(plan.priceCents * (multipliers[cycle] ?? 1));
    }
  }

  return c.json({
    billingModel,
    cycle,
    fixedCostCents,
    usageCostCents: usageSummary.estimatedCostCents,
    totalEstimateCents: billingModel === 'fixed'
      ? fixedCostCents
      : billingModel === 'usage'
        ? usageSummary.estimatedCostCents
        : fixedCostCents + usageSummary.estimatedCostCents,
    usageBreakdown: usageSummary.breakdown,
  });
});

// GET /resource-limits — effective resource limits for this account
authed.get('/resource-limits', async (c) => {
  const accountId = c.get('accountId');

  const global = await db.query.resourceLimits.findFirst({
    where: isNull(resourceLimits.accountId),
  });

  let override = null;
  if (accountId) {
    override = await db.query.resourceLimits.findFirst({
      where: eq(resourceLimits.accountId, accountId),
    });
  }

  return c.json({
    maxCpuPerContainer: override?.maxCpuPerContainer ?? global?.maxCpuPerContainer ?? null,
    maxMemoryPerContainer: override?.maxMemoryPerContainer ?? global?.maxMemoryPerContainer ?? null,
    maxReplicas: override?.maxReplicas ?? global?.maxReplicas ?? null,
    maxContainers: override?.maxContainers ?? global?.maxContainers ?? null,
    maxStorageGb: override?.maxStorageGb ?? global?.maxStorageGb ?? null,
    maxBandwidthGb: override?.maxBandwidthGb ?? global?.maxBandwidthGb ?? null,
    maxNfsStorageGb: override?.maxNfsStorageGb ?? global?.maxNfsStorageGb ?? null,
  });
});

// ─── Service suspension helper ────────────────────────────────────────────────

/** Suspend all running services for an account (e.g., after payment failure). */
async function suspendAccountServices(accountId: string) {
  const accountServices = await db.query.services.findMany({
    where: and(eq(services.accountId, accountId), eq(services.status, 'running'), isNull(services.deletedAt)),
  });

  for (const svc of accountServices) {
    try {
      if (svc.dockerServiceId) {
        await dockerService.scaleService(svc.dockerServiceId, 0);
      }
      await db.update(services)
        .set({ status: 'suspended', stoppedAt: new Date(), updatedAt: new Date() })
        .where(eq(services.id, svc.id));
    } catch (err) {
      logger.error({ err, serviceId: svc.id }, 'Failed to suspend service');
    }
  }
}

// ─── Webhook route (unauthenticated, signature-verified) ─────────────────────

billing.post('/webhook', async (c) => {
  const signature = c.req.header('stripe-signature');
  if (!signature) {
    return c.json({ error: 'Missing stripe-signature header' }, 400);
  }

  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json({ error: 'Failed to read request body' }, 400);
  }

  let event;
  try {
    event = stripeService.constructWebhookEvent(rawBody, signature);
  } catch (err) {
    logger.error({ err }, 'Webhook signature verification failed');
    return c.json({ error: 'Invalid signature' }, 400);
  }

  // Atomic idempotency check — INSERT with conflict handling
  try {
    await db.insert(webhookEvents).values({
      stripeEventId: event.id,
      eventType: event.type,
      processedAt: new Date(),
    });
  } catch (err: any) {
    // If insert fails due to unique constraint on stripeEventId, it's a duplicate
    if (err?.message?.includes('UNIQUE') || err?.message?.includes('unique') || err?.message?.includes('duplicate')) {
      return c.json({ received: true, duplicate: true });
    }
    throw err; // Re-throw unexpected errors
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as {
        customer?: string;
        subscription?: string;
        metadata?: Record<string, string>;
        payment_intent?: string;
      };

      if (session.metadata?.type === 'domain_registration') {
        try {
          const { registrarService } = await import('../services/registrar.service.js');
          const { domainRegistrations: domRegTable } = await import('@fleet/db');

          // Look up the account owner to use real contact data for WHOIS
          const domain = session.metadata.domain!;
          const accountId = session.metadata.accountId!;
          const ownerMembership = await db.query.userAccounts.findFirst({
            where: and(eq(userAccounts.accountId, accountId), eq(userAccounts.role, 'owner')),
            with: { user: true },
          });
          const purchaseUser = ownerMembership?.user ?? null;

          const contact = {
            firstName: purchaseUser?.name?.split(' ')[0] ?? 'Account',
            lastName: purchaseUser?.name?.split(' ').slice(1).join(' ') || 'Owner',
            email: purchaseUser?.email ?? 'admin@' + domain,
            phone: '0000000000',
            address1: 'See account profile',
            city: 'See account profile',
            state: 'N/A',
            postalCode: '00000',
            country: 'US',
          };

          // Warn if using simulated registrar in production after real payment
          const provider = await registrarService.getProvider();
          if (provider.name === 'simulated' && process.env['NODE_ENV'] === 'production') {
            logger.error({ domain }, 'Domain registration after payment is using SIMULATED registrar! Configure a real registrar provider.');
          }

          const registration = await registrarService.registerDomain(
            domain, Number(session.metadata.years) || 1,
            contact, accountId,
          );

          if (registration?.id && session.payment_intent) {
            await db.update(domRegTable)
              .set({ stripePaymentId: session.payment_intent as string })
              .where(eq(domRegTable.id, registration.id));
          }
        } catch (err) {
          logger.error({ err }, 'Domain registration after payment failed');
        }
      } else if (session.metadata?.type === 'domain_renewal') {
        try {
          const { registrarService } = await import('../services/registrar.service.js');
          await registrarService.renewDomain(session.metadata.registrationId!, Number(session.metadata.years) || 1);
        } catch (err) {
          logger.error({ err }, 'Domain renewal after payment failed');
        }
      } else if (session.customer && session.subscription) {
        const account = await db.query.accounts.findFirst({
          where: and(eq(accounts.stripeCustomerId, session.customer), isNull(accounts.deletedAt)),
        });

        if (account) {
          const billingModel = (session.metadata?.billingModel ?? 'fixed') as string;
          const billingCycle = session.metadata?.billingCycle ?? 'monthly';
          const planId = session.metadata?.planId ?? null;

          // Wrap subscription creation + account update in a transaction
          await safeTransaction(async (tx) => {
            // Check for existing active subscription
            const existingSub = await tx.query.subscriptions.findFirst({
              where: and(
                eq(subscriptions.accountId, account.id),
                eq(subscriptions.status, 'active'),
              ),
            });
            if (existingSub) {
              logger.warn({ accountId: account.id, existingSubId: existingSub.id }, 'Blocked duplicate active subscription');
              return; // Don't create another active subscription
            }

            await tx.insert(subscriptions).values({
              accountId: account.id,
              planId,
              billingModel,
              billingCycle,
              stripeSubscriptionId: session.subscription!,
              stripeCustomerId: session.customer!,
              status: 'active',
            });

            await tx.update(accounts)
              .set({ updatedAt: new Date() })
              .where(eq(accounts.id, account.id));
          });
        }
      }
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object as {
        subscription?: string;
        period_start?: number;
        period_end?: number;
      };
      if (invoice.subscription) {
        await db
          .update(subscriptions)
          .set({
            currentPeriodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : undefined,
            currentPeriodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : undefined,
            status: 'active',
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.stripeSubscriptionId, invoice.subscription));
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as any;
      const subId = invoice.subscription as string;
      if (!subId) break;

      const dbSub = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.stripeSubscriptionId, subId),
      });
      if (!dbSub) break;

      if (!invoice.next_payment_attempt) {
        // Final attempt failed — mark as past_due but don't suspend immediately
        // Give 7-day grace period
        await db.update(subscriptions)
          .set({
            status: 'past_due',
            updatedAt: new Date()
          })
          .where(eq(subscriptions.id, dbSub.id));

        logger.warn({ accountId: dbSub.accountId, subscriptionId: dbSub.id },
          'Final payment attempt failed — subscription marked past_due (7-day grace period)');

        // Create a notification for the account owner
        try {
          const { notifications } = await import('@fleet/db');
          await db.insert(notifications).values({
            id: crypto.randomUUID(),
            accountId: dbSub.accountId,
            type: 'billing',
            title: 'Payment Failed',
            message: 'Your payment has failed after all retry attempts. Please update your payment method within 7 days to avoid service suspension.',
            read: false,
          });
        } catch { /* notification is best-effort */ }
      } else {
        // Not final — just log warning
        logger.warn({ accountId: dbSub.accountId, attempt: invoice.attempt_count },
          'Payment attempt failed — Stripe will retry');
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as {
        id?: string;
        status?: string;
        trial_end?: number | null;
        current_period_start?: number;
        current_period_end?: number;
        canceled_at?: number | null;
      };
      if (sub.id) {
        const statusMap: Record<string, string> = {
          active: 'active', past_due: 'past_due', canceled: 'cancelled',
          unpaid: 'past_due', trialing: 'trialing', incomplete: 'incomplete',
        };
        const mappedStatus = statusMap[sub.status ?? ''] ?? sub.status ?? 'active';

        await db
          .update(subscriptions)
          .set({
            status: mappedStatus,
            trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : undefined,
            currentPeriodStart: sub.current_period_start ? new Date(sub.current_period_start * 1000) : undefined,
            currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : undefined,
            cancelledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : undefined,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.stripeSubscriptionId, sub.id));
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as { id: string };
      const dbSub = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.stripeSubscriptionId, sub.id),
      });
      if (dbSub) {
        await db.update(subscriptions)
          .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date() })
          .where(eq(subscriptions.id, dbSub.id));

        // Suspend services after subscription cancellation
        await suspendAccountServices(dbSub.accountId);
        logger.info({ accountId: dbSub.accountId }, 'Subscription cancelled — services suspended');
      }
      break;
    }

    case 'charge.dispute.created': {
      const dispute = event.data.object as any;
      const customerId = dispute.customer as string;
      if (!customerId) break;

      // Find the account with this Stripe customer
      const disputeAccount = await db.query.accounts.findFirst({
        where: eq(accounts.stripeCustomerId, customerId),
      });
      if (!disputeAccount) break;

      // Suspend services immediately on dispute
      await suspendAccountServices(disputeAccount.id);

      logger.error({ accountId: disputeAccount.id, disputeId: dispute.id, amount: dispute.amount },
        'Charge dispute received — services suspended');

      // Create notification
      try {
        const { notifications } = await import('@fleet/db');
        await db.insert(notifications).values({
          id: crypto.randomUUID(),
          accountId: disputeAccount.id,
          type: 'billing',
          title: 'Payment Dispute Received',
          message: 'A payment dispute has been filed. Your services have been suspended pending resolution. Please contact support.',
          read: false,
        });
      } catch { /* best-effort */ }
      break;
    }

    case 'charge.refunded': {
      const refundCharge = event.data.object as any;
      logger.info({ chargeId: refundCharge.id, amount: refundCharge.amount_refunded },
        'Charge refunded');
      break;
    }

    default:
      break;
  }

  return c.json({ received: true });
});

billing.route('/', authed);

export default billing;
