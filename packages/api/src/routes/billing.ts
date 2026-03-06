import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import {
  db,
  accounts,
  billingPlans,
  billingPlanPrices,
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
  inArray,
  webhookEvents,
  safeTransaction,
} from '@fleet/db';
import { authMiddleware, requireScope, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { stripeService } from '../services/stripe.service.js';
import { stripeSyncService } from '../services/stripe-sync.service.js';
import { usageService } from '../services/usage.service.js';
import { orchestrator } from '../services/orchestrator.js';
import { requireOwner } from '../middleware/rbac.js';
import { calculateResellerPricing } from './reseller.js';
import { logger, logToErrorTable } from '../services/logger.js';
import { exchangeRateService } from '../services/exchange-rate.service.js';
import { currencyService } from '../services/currency.service.js';
import { emailService } from '../services/email.service.js';
import { getEmailQueue, isQueueAvailable } from '../services/queue.service.js';
import type { EmailJobData } from '../workers/email.worker.js';
import { getAppUrl, getAppUrlSync } from '../services/platform.service.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

async function queueEmail(data: EmailJobData): Promise<void> {
  if (isQueueAvailable()) {
    await getEmailQueue().add('send-email', data);
  } else {
    emailService.sendTemplateEmail(data.templateSlug, data.to, data.variables, data.accountId)
      .catch((err) => {
        logger.error({ err }, `Failed to send ${data.templateSlug} email`);
        logToErrorTable({ level: 'error', message: `Failed to send ${data.templateSlug} email: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'queue-email-fallback', templateSlug: data.templateSlug } });
      });
  }
}

/** Validate that a redirect URL belongs to the app's origin (prevents open redirects via Stripe). */
function validateRedirectUrl(url: string): boolean {
  const appUrl = getAppUrlSync();
  if (appUrl === 'http://localhost:5173') return process.env['NODE_ENV'] !== 'production'; // Reject in production if not configured
  // Only allow relative paths starting with / (but not // which is protocol-relative)
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  try {
    const parsed = new URL(url);
    const app = new URL(appUrl);
    // Only allow http/https protocols (block javascript:, data:, etc.)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
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

const billing = new OpenAPIHono<BillingEnv>();

// ─── Authenticated + tenant-scoped routes ────────────────────────────────────

const authed = new OpenAPIHono<BillingEnv>();
authed.use('*', authMiddleware);
authed.use('*', tenantMiddleware);

// ── Schemas ──

const checkoutSchema = z.object({
  billingModel: z.enum(['fixed', 'usage', 'hybrid']),
  billingCycle: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly']),
  planId: z.string().optional(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
}).openapi('CheckoutRequest');

const changeCycleSchema = z.object({
  cycle: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly']),
}).openapi('ChangeCycleRequest');

const portalSchema = z.object({
  returnUrl: z.string().url(),
}).openapi('PortalRequest');

const billingConfigSchema = z.object({
  billingModel: z.enum(['fixed', 'usage', 'hybrid']).optional(),
  allowUserChoice: z.boolean().optional(),
  allowedCycles: z.array(z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'])).min(1).optional(),
  cycleDiscounts: z.record(
    z.string(),
    z.object({
      type: z.enum(['fixed', 'percentage']),
      value: z.number().min(0),
    }),
  ).refine(
    (obj) => Object.keys(obj).every(k => ['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly'].includes(k)),
    { message: 'Keys must be valid billing cycles (daily, weekly, monthly, quarterly, half_yearly, yearly)' },
  ).optional(),
  trialDays: z.number().int().min(0).optional(),
  suspensionGraceDays: z.number().int().min(1).optional(),
  deletionGraceDays: z.number().int().min(1).optional(),
  autoSuspendEnabled: z.boolean().optional(),
  autoDeleteEnabled: z.boolean().optional(),
  suspensionWarningDays: z.number().int().min(0).optional(),
  deletionWarningDays: z.number().int().min(0).optional(),
  volumeDeletionEnabled: z.boolean().optional(),
  purgeEnabled: z.boolean().optional(),
  purgeRetentionDays: z.number().int().min(1).optional(),
  allowDowngrade: z.boolean().optional(),
  deletionBillingPolicy: z.enum(['immediate', 'end_of_period']).optional(),
  maxFreeServicesPerAccount: z.number().int().min(0).nullable().optional(),
}).openapi('BillingConfigRequest');

const slugParamSchema = z.object({
  slug: z.string().openapi({ description: 'Plan slug' }),
});

const paymentMethodIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Payment method ID' }),
});

const pricePreviewQuerySchema = z.object({
  planId: z.string().optional(),
  cycle: z.string().optional(),
});

const usageHistoryQuerySchema = z.object({
  limit: z.string().optional(),
  offset: z.string().optional(),
});

const estimateQuerySchema = z.object({
  billingModel: z.string().optional(),
  planId: z.string().optional(),
  cycle: z.string().optional(),
});

// ── Route definitions ──

const listPlansRoute = createRoute({
  method: 'get',
  path: '/plans',
  tags: ['Billing'],
  summary: 'List all visible billing plans',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.any()), 'List of billing plans'),
    ...standardErrors,
  },
});

const getPlanRoute = createRoute({
  method: 'get',
  path: '/plans/{slug}',
  tags: ['Billing'],
  summary: 'Get a specific plan by slug',
  security: bearerSecurity,
  request: {
    params: slugParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Plan details'),
    ...standardErrors,
  },
});

const checkoutRoute = createRoute({
  method: 'post',
  path: '/checkout',
  tags: ['Billing'],
  summary: 'Create a Stripe Checkout session',
  security: bearerSecurity,
  middleware: [requireOwner, requireScope('admin')] as const,
  request: {
    body: jsonBody(checkoutSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Checkout session'),
    ...standardErrors,
  },
});

const getSubscriptionRoute = createRoute({
  method: 'get',
  path: '/subscription',
  tags: ['Billing'],
  summary: 'Get current subscription for the account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Subscription details'),
    ...standardErrors,
  },
});

const changeCycleRoute = createRoute({
  method: 'patch',
  path: '/subscription/cycle',
  tags: ['Billing'],
  summary: 'Change billing cycle',
  security: bearerSecurity,
  middleware: [requireOwner, requireScope('admin')] as const,
  request: {
    body: jsonBody(changeCycleSchema),
  },
  responses: {
    200: jsonContent(z.object({ message: z.string(), cycle: z.string() }), 'Cycle updated'),
    ...standardErrors,
  },
});

const cancelSubscriptionRoute = createRoute({
  method: 'delete',
  path: '/subscription',
  tags: ['Billing'],
  summary: 'Cancel subscription at period end',
  security: bearerSecurity,
  middleware: [requireOwner, requireScope('admin')] as const,
  responses: {
    200: jsonContent(messageResponseSchema, 'Subscription cancellation confirmed'),
    ...standardErrors,
  },
});

const getUsageRoute = createRoute({
  method: 'get',
  path: '/usage',
  tags: ['Billing'],
  summary: 'Get usage summary with cost estimates',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Usage summary'),
    ...standardErrors,
  },
});

const getUsageHistoryRoute = createRoute({
  method: 'get',
  path: '/usage/history',
  tags: ['Billing'],
  summary: 'Get paginated usage records',
  security: bearerSecurity,
  request: {
    query: usageHistoryQuerySchema,
  },
  responses: {
    200: jsonContent(z.array(z.any()), 'Usage records'),
    ...standardErrors,
  },
});

const getInvoicesRoute = createRoute({
  method: 'get',
  path: '/invoices',
  tags: ['Billing'],
  summary: 'Get invoice history from Stripe',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Invoice list'),
    ...standardErrors,
  },
});

const createPortalRoute = createRoute({
  method: 'post',
  path: '/portal',
  tags: ['Billing'],
  summary: 'Create a Stripe customer billing portal session',
  security: bearerSecurity,
  middleware: [requireOwner] as const,
  request: {
    body: jsonBody(portalSchema),
  },
  responses: {
    200: jsonContent(z.object({ url: z.string() }), 'Portal session URL'),
    ...standardErrors,
  },
});

const getPaymentMethodsRoute = createRoute({
  method: 'get',
  path: '/payment-methods',
  tags: ['Billing'],
  summary: 'List payment methods for the account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Payment methods'),
    ...standardErrors,
  },
});

const setupPaymentMethodRoute = createRoute({
  method: 'post',
  path: '/payment-methods/setup',
  tags: ['Billing'],
  summary: 'Create a setup intent for adding a new payment method',
  security: bearerSecurity,
  middleware: [requireOwner] as const,
  responses: {
    200: jsonContent(z.object({ clientSecret: z.string().nullable() }), 'Setup intent client secret'),
    ...standardErrors,
  },
});

const setDefaultPaymentMethodRoute = createRoute({
  method: 'patch',
  path: '/payment-methods/{id}/default',
  tags: ['Billing'],
  summary: 'Set a payment method as default',
  security: bearerSecurity,
  middleware: [requireOwner] as const,
  request: {
    params: paymentMethodIdParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Default payment method updated'),
    ...standardErrors,
  },
});

const deletePaymentMethodRoute = createRoute({
  method: 'delete',
  path: '/payment-methods/{id}',
  tags: ['Billing'],
  summary: 'Remove a payment method',
  security: bearerSecurity,
  middleware: [requireOwner] as const,
  request: {
    params: paymentMethodIdParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Payment method removed'),
    ...standardErrors,
  },
});

const getConfigRoute = createRoute({
  method: 'get',
  path: '/config',
  tags: ['Billing'],
  summary: 'Get billing configuration',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Billing configuration'),
    ...standardErrors,
  },
});

const updateConfigRoute = createRoute({
  method: 'patch',
  path: '/config',
  tags: ['Billing'],
  summary: 'Update platform billing configuration (super admin only)',
  security: bearerSecurity,
  request: {
    body: jsonBody(billingConfigSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Updated billing configuration'),
    201: jsonContent(z.any(), 'Created billing configuration'),
  },
});

const pricePreviewRoute = createRoute({
  method: 'get',
  path: '/price-preview',
  tags: ['Billing'],
  summary: 'Calculate price for a specific plan and cycle',
  security: bearerSecurity,
  request: {
    query: pricePreviewQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Price preview'),
    ...standardErrors,
  },
});

const estimateRoute = createRoute({
  method: 'get',
  path: '/estimate',
  tags: ['Billing'],
  summary: 'Cost estimate based on current usage for a plan and cycle',
  security: bearerSecurity,
  request: {
    query: estimateQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Cost estimate'),
    ...standardErrors,
  },
});

const resourceLimitsRoute = createRoute({
  method: 'get',
  path: '/resource-limits',
  tags: ['Billing'],
  summary: 'Get effective resource limits for this account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Resource limits'),
    ...standardErrors,
  },
});

// ── Handlers ──

// GET /plans — list all visible billing plans
authed.openapi(listPlansRoute, (async (c: any) => {
  const plans = await db.query.billingPlans.findMany({
    where: eq(billingPlans.visible, true),
    orderBy: (p: any, { asc }: any) => asc(p.sortOrder),
  });

  return c.json(plans);
}) as any);

// GET /plans/:slug — get a specific plan by slug
authed.openapi(getPlanRoute, (async (c: any) => {
  const { slug } = c.req.valid('param');
  const plan = await db.query.billingPlans.findFirst({
    where: and(eq(billingPlans.slug, slug), eq(billingPlans.visible, true)),
  });

  if (!plan) {
    return c.json({ error: 'Plan not found' }, 404);
  }

  return c.json(plan);
}) as any);

// POST /checkout — create a Stripe Checkout session
authed.openapi(checkoutRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { billingModel, billingCycle, planId, successUrl, cancelUrl } = c.req.valid('json');

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
    logToErrorTable({ level: 'error', message: `Failed to create checkout session: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'create-checkout-session' } });
    return c.json({ error: 'Checkout failed' }, 400);
  }
}) as any);

// GET /subscription — current subscription for the account
authed.openapi(getSubscriptionRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const sub = await db.query.subscriptions.findFirst({
    where: eq(subscriptions.accountId, accountId),
    with: { plan: true },
    orderBy: (s: any, { desc: d }: any) => d(s.createdAt),
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
}) as any);

// PATCH /subscription/cycle — change billing cycle
authed.openapi(changeCycleRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { cycle } = c.req.valid('json');

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
}) as any);

// DELETE /subscription — cancel subscription at period end
authed.openapi(cancelSubscriptionRoute, (async (c: any) => {
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
      logToErrorTable({ level: 'error', message: `Failed to cancel Stripe subscription: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'cancel-stripe-subscription' } });
      return c.json({ error: 'Failed to cancel subscription' }, 500);
    }
  }

  await db.update(subscriptions)
    .set({ cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(subscriptions.id, sub.id));

  // Services remain active until end of billing period.
  // Suspension happens when Stripe fires customer.subscription.deleted webhook.

  return c.json({ message: 'Subscription will cancel at end of billing period' });
}) as any);

// GET /usage — usage summary with cost estimates
authed.openapi(getUsageRoute, (async (c: any) => {
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
}) as any);

// GET /usage/history — paginated usage records
authed.openapi(getUsageHistoryRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const query = c.req.valid('query');
  const limit = Math.min(Number(query.limit ?? 50), 100);
  const offset = Number(query.offset ?? 0);

  const records = await db.query.usageRecords.findMany({
    where: eq(usageRecords.accountId, accountId),
    orderBy: (u: any, { desc: d }: any) => d(u.recordedAt),
    limit,
    offset,
  });

  return c.json(records);
}) as any);

// GET /invoices — invoice history from Stripe
authed.openapi(getInvoicesRoute, (async (c: any) => {
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
    const invoices = result.data.map((inv: any) => ({
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
    logToErrorTable({ level: 'error', message: `Failed to fetch invoices from Stripe: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'fetch-invoices' } });
    return c.json({ error: 'Failed to fetch invoices' }, 500);
  }
}) as any);

// POST /portal — create a Stripe customer billing portal session
authed.openapi(createPortalRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { returnUrl } = c.req.valid('json');

  // Validate return URL against APP_URL to prevent open redirects
  if (!validateRedirectUrl(returnUrl)) {
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
    returnUrl,
  );

  return c.json({ url: session.url });
}) as any);

// GET /payment-methods — list payment methods for the account
authed.openapi(getPaymentMethodsRoute, (async (c: any) => {
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
      methods: methods.data.map((pm: any) => ({
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
    logToErrorTable({ level: 'error', message: `Failed to fetch payment methods: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'fetch-payment-methods' } });
    return c.json({ error: 'Failed to fetch payment methods' }, 500);
  }
}) as any);

// POST /payment-methods/setup — create a setup intent for adding a new payment method
authed.openapi(setupPaymentMethodRoute, (async (c: any) => {
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
    logToErrorTable({ level: 'error', message: `Failed to create setup intent: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'create-setup-intent' } });
    return c.json({ error: 'Failed to create setup intent' }, 500);
  }
}) as any);

// PATCH /payment-methods/:id/default — set a payment method as default
authed.openapi(setDefaultPaymentMethodRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: paymentMethodId } = c.req.valid('param');
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
    logToErrorTable({ level: 'error', message: `Failed to set default payment method: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'set-default-payment-method' } });
    return c.json({ error: 'Failed to update default payment method' }, 500);
  }
}) as any);

// DELETE /payment-methods/:id — remove a payment method
authed.openapi(deletePaymentMethodRoute, (async (c: any) => {
  const { id: paymentMethodId } = c.req.valid('param');
  const accountId = c.get('accountId');

  // Verify the payment method belongs to this account's Stripe customer
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId!), isNull(accounts.deletedAt)),
  });
  if (!account?.stripeCustomerId) {
    return c.json({ error: 'No billing account found' }, 400);
  }

  try {
    const methods = await stripeService.listPaymentMethods(account.stripeCustomerId);
    if (!methods.data.some((pm: any) => pm.id === paymentMethodId)) {
      return c.json({ error: 'Payment method not found' }, 404);
    }

    await stripeService.detachPaymentMethod(paymentMethodId);
    return c.json({ message: 'Payment method removed' });
  } catch (err) {
    logger.error({ err }, 'Failed to detach payment method');
    logToErrorTable({ level: 'error', message: `Failed to detach payment method: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'detach-payment-method' } });
    return c.json({ error: 'Failed to remove payment method' }, 500);
  }
}) as any);

// GET /config — billing configuration (public for end users)
authed.openapi(getConfigRoute, (async (c: any) => {
  const config = await db.query.billingConfig.findFirst();
  const pricing = await db.query.pricingConfig.findFirst();
  const locations = await db.query.locationMultipliers.findMany();

  return c.json({
    billingModel: config?.billingModel ?? 'fixed',
    allowUserChoice: config?.allowUserChoice ?? false,
    allowedCycles: config?.allowedCycles ?? ['monthly', 'yearly'],
    cycleDiscounts: config?.cycleDiscounts ?? {},
    trialDays: config?.trialDays ?? 0,
    allowDowngrade: config?.allowDowngrade ?? true,
    deletionBillingPolicy: config?.deletionBillingPolicy ?? 'end_of_period',
    maxFreeServicesPerAccount: config?.maxFreeServicesPerAccount ?? null,
    pricingConfig: pricing ? {
      cpuCentsPerHour: pricing.cpuCentsPerHour ?? 0,
      memoryCentsPerGbHour: pricing.memoryCentsPerGbHour ?? 0,
      storageCentsPerGbMonth: pricing.storageCentsPerGbMonth ?? 0,
      bandwidthCentsPerGb: pricing.bandwidthCentsPerGb ?? 0,
      containerCentsPerHour: pricing.containerCentsPerHour ?? 0,
      locationPricingEnabled: pricing.locationPricingEnabled ?? false,
    } : null,
    locations: locations.map((l: any) => ({
      locationKey: l.locationKey,
      label: l.label,
      multiplier: l.multiplier,
    })),
  });
}) as any);

// PATCH /config — update platform billing configuration (super admin only)
authed.openapi(updateConfigRoute, (async (c: any) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super user access required' }, 403);
  }

  const data = c.req.valid('json');

  const existing = await db.query.billingConfig.findFirst();

  let result;
  if (existing) {
    const [updated] = await updateReturning(billingConfig, {
      ...data,
      updatedAt: new Date(),
    }, eq(billingConfig.id, existing.id));
    result = updated;
  } else {
    const [created] = await insertReturning(billingConfig, {
      billingModel: data.billingModel ?? 'fixed',
      allowUserChoice: data.allowUserChoice ?? false,
      allowedCycles: data.allowedCycles ?? ['monthly', 'yearly'],
      cycleDiscounts: data.cycleDiscounts ?? {},
      trialDays: data.trialDays ?? 0,
      allowDowngrade: data.allowDowngrade ?? true,
      deletionBillingPolicy: data.deletionBillingPolicy ?? 'end_of_period',
    });
    result = created;
  }

  // Auto-create metered Stripe prices when switching to usage or hybrid billing
  const effectiveModel = data.billingModel ?? existing?.billingModel ?? 'fixed';
  if (effectiveModel === 'usage' || effectiveModel === 'hybrid') {
    stripeSyncService.ensureMeteredPrices().catch((err) => {
      logger.error({ err }, 'Failed to auto-create metered Stripe prices');
      logToErrorTable({ level: 'error', message: `Failed to auto-create metered Stripe prices: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'ensure-metered-prices' } });
    });
  }

  return c.json(result, existing ? 200 : 201);
}) as any);

// GET /price-preview — calculate price for a specific cycle
authed.openapi(pricePreviewRoute, (async (c: any) => {
  const query = c.req.valid('query');
  const planId = query.planId;
  const cycle = query.cycle as string | undefined;

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

  // Apply reseller pricing (discount/markup) after all other discounts
  let resellerDiscount = 0;
  let resellerMarkup = 0;
  let finalPrice = cyclePriceCents;

  if (accountId) {
    const resellerPricing = await calculateResellerPricing(accountId, cyclePriceCents);
    resellerDiscount = resellerPricing.discountAmount;
    resellerMarkup = resellerPricing.markupAmount;
    finalPrice = resellerPricing.finalPrice;
  }

  return c.json({
    planId: plan.id,
    planName: plan.name,
    cycle,
    monthlyPriceCents: monthlyPrice,
    cyclePriceCents,
    discountAmount,
    discount: discount ?? null,
    resellerDiscount,
    resellerMarkup,
    finalPrice,
  });
}) as any);

// GET /estimate — cost estimate based on current usage for a plan+cycle
authed.openapi(estimateRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const query = c.req.valid('query');
  const billingModel = query.billingModel ?? 'fixed';
  const planId = query.planId;
  const cycle = query.cycle ?? 'monthly';

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
}) as any);

// GET /resource-limits — effective resource limits for this account
authed.openapi(resourceLimitsRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  const global = await db.query.resourceLimits.findFirst({
    where: isNull(resourceLimits.accountId),
  });

  let override = null;
  let maxUsersPerAccount: number | null = null;
  if (accountId) {
    override = await db.query.resourceLimits.findFirst({
      where: eq(resourceLimits.accountId, accountId),
    });

    const accountSub = await db.query.subscriptions.findFirst({
      where: (s: any, { and, eq: e }: any) => and(e(s.accountId, accountId), e(s.status, 'active')),
      with: { plan: true },
    });
    maxUsersPerAccount = (accountSub as any)?.plan?.maxUsersPerAccount ?? null;
  }

  return c.json({
    maxCpuPerContainer: override?.maxCpuPerContainer ?? global?.maxCpuPerContainer ?? null,
    maxMemoryPerContainer: override?.maxMemoryPerContainer ?? global?.maxMemoryPerContainer ?? null,
    maxReplicas: override?.maxReplicas ?? global?.maxReplicas ?? null,
    maxContainers: override?.maxContainers ?? global?.maxContainers ?? null,
    maxStorageGb: override?.maxStorageGb ?? global?.maxStorageGb ?? null,
    maxBandwidthGb: override?.maxBandwidthGb ?? global?.maxBandwidthGb ?? null,
    maxNfsStorageGb: override?.maxNfsStorageGb ?? global?.maxNfsStorageGb ?? null,
    maxTotalCpuCores: override?.maxTotalCpuCores ?? global?.maxTotalCpuCores ?? null,
    maxTotalMemoryMb: override?.maxTotalMemoryMb ?? global?.maxTotalMemoryMb ?? null,
    maxUsersPerAccount,
  });
}) as any);

// ─── Per-service / per-stack billing endpoints ────────────────────────────────

const serviceCheckoutSchema = z.object({
  serviceId: z.string().optional(),
  stackId: z.string().optional(),
  planId: z.string(),
  billingCycle: z.enum(['daily', 'weekly', 'monthly', 'quarterly', 'half_yearly', 'yearly']),
  currency: z.string().length(3).optional(),
  paymentMethodId: z.string().optional(),
  billingContactEmail: z.string().email().optional(),
  billingContactName: z.string().optional(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
}).refine(d => d.serviceId || d.stackId, { message: 'Either serviceId or stackId is required' })
  .openapi('ServiceCheckoutRequest');

const serviceSubIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Subscription ID' }),
});

const serviceIdParamSchema = z.object({
  serviceId: z.string().openapi({ description: 'Service ID' }),
});

const changePlanSchema = z.object({
  planId: z.string(),
}).openapi('ChangePlanRequest');

const changePaymentMethodSchema = z.object({
  paymentMethodId: z.string(),
}).openapi('ChangePaymentMethodRequest');

const updateContactSchema = z.object({
  billingContactEmail: z.string().email().optional(),
  billingContactName: z.string().optional(),
}).openapi('UpdateBillingContactRequest');

// Route definitions

const serviceCheckoutRoute = createRoute({
  method: 'post',
  path: '/service-subscriptions/checkout',
  tags: ['Service Billing'],
  summary: 'Create a Stripe checkout session for a service/stack subscription',
  security: bearerSecurity,
  middleware: [requireOwner, requireScope('admin')] as const,
  request: { body: jsonBody(serviceCheckoutSchema) },
  responses: {
    200: jsonContent(z.object({ url: z.string() }), 'Checkout URL'),
    ...standardErrors,
  },
});

const listServiceSubscriptionsRoute = createRoute({
  method: 'get',
  path: '/service-subscriptions',
  tags: ['Service Billing'],
  summary: 'List all service/stack subscriptions for this account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.any()), 'Service subscriptions'),
    ...standardErrors,
  },
});

const getServiceSubscriptionRoute = createRoute({
  method: 'get',
  path: '/service-subscriptions/{id}',
  tags: ['Service Billing'],
  summary: 'Get a single service subscription',
  security: bearerSecurity,
  request: { params: serviceSubIdParamSchema },
  responses: {
    200: jsonContent(z.any(), 'Service subscription detail'),
    ...standardErrors,
  },
});

const getSubscriptionForServiceRoute = createRoute({
  method: 'get',
  path: '/services/{serviceId}/subscription',
  tags: ['Service Billing'],
  summary: 'Get the subscription for a specific service',
  security: bearerSecurity,
  request: { params: serviceIdParamSchema },
  responses: {
    200: jsonContent(z.any(), 'Subscription for service'),
    ...standardErrors,
  },
});

const changeServicePlanRoute = createRoute({
  method: 'patch',
  path: '/service-subscriptions/{id}/plan',
  tags: ['Service Billing'],
  summary: 'Change the tier (upgrade/downgrade) of a service subscription',
  security: bearerSecurity,
  middleware: [requireOwner, requireScope('admin')] as const,
  request: { params: serviceSubIdParamSchema, body: jsonBody(changePlanSchema) },
  responses: {
    200: jsonContent(messageResponseSchema, 'Plan changed'),
    ...standardErrors,
  },
});

const changeServicePaymentMethodRoute = createRoute({
  method: 'patch',
  path: '/service-subscriptions/{id}/payment-method',
  tags: ['Service Billing'],
  summary: 'Change the payment method for a service subscription',
  security: bearerSecurity,
  middleware: [requireOwner, requireScope('admin')] as const,
  request: { params: serviceSubIdParamSchema, body: jsonBody(changePaymentMethodSchema) },
  responses: {
    200: jsonContent(messageResponseSchema, 'Payment method changed'),
    ...standardErrors,
  },
});

const updateServiceContactRoute = createRoute({
  method: 'patch',
  path: '/service-subscriptions/{id}/contact',
  tags: ['Service Billing'],
  summary: 'Update billing contact for a service subscription',
  security: bearerSecurity,
  middleware: [requireOwner, requireScope('admin')] as const,
  request: { params: serviceSubIdParamSchema, body: jsonBody(updateContactSchema) },
  responses: {
    200: jsonContent(messageResponseSchema, 'Billing contact updated'),
    ...standardErrors,
  },
});

const cancelServiceSubscriptionRoute = createRoute({
  method: 'delete',
  path: '/service-subscriptions/{id}',
  tags: ['Service Billing'],
  summary: 'Cancel a service subscription at period end',
  security: bearerSecurity,
  middleware: [requireOwner, requireScope('admin')] as const,
  request: { params: serviceSubIdParamSchema },
  responses: {
    200: jsonContent(messageResponseSchema, 'Cancellation confirmed'),
    ...standardErrors,
  },
});

const freeTierUsageRoute = createRoute({
  method: 'get',
  path: '/free-tier-usage',
  tags: ['Service Billing'],
  summary: 'Get free tier usage for the current account',
  security: bearerSecurity,
  middleware: [requireOwner, requireScope('admin')] as const,
  responses: {
    200: jsonContent(z.object({ used: z.number(), limit: z.number().nullable() }), 'Free tier usage'),
    ...standardErrors,
  },
});

// Handlers

// POST /service-subscriptions/checkout
authed.openapi(serviceCheckoutRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const data = c.req.valid('json');

  if (!validateRedirectUrl(data.successUrl) || !validateRedirectUrl(data.cancelUrl)) {
    return c.json({ error: 'Invalid redirect URL: must match application origin' }, 400);
  }

  // Check Stripe is configured before doing anything
  if (!(await stripeService.isConfigured())) {
    return c.json({ error: 'Billing is not configured. An administrator must set up Stripe in the admin settings.' }, 503);
  }

  // Enforce free tier limit per account
  const selectedPlan = await db.query.billingPlans.findFirst({
    where: eq(billingPlans.id, data.planId),
  });
  if (selectedPlan?.isFree) {
    const config = await db.query.billingConfig.findFirst();
    const override = await db.query.accountBillingOverrides.findFirst({
      where: eq(accountBillingOverrides.accountId, accountId),
    });
    // Per-account override takes priority over global setting
    const maxFree = override?.maxFreeServices ?? config?.maxFreeServicesPerAccount;
    if (maxFree != null) {
      const freePlanIds = (await db.select({ id: billingPlans.id }).from(billingPlans).where(eq(billingPlans.isFree, true))).map(p => p.id);
      const freeSubCount = await db.select({ count: countSql() }).from(subscriptions)
        .where(and(
          eq(subscriptions.accountId, accountId),
          isNull(subscriptions.cancelledAt),
          freePlanIds.length > 0 ? inArray(subscriptions.planId, freePlanIds) : undefined,
        ));
      const used = Number(freeSubCount[0]?.count ?? 0);
      if (used >= maxFree) {
        return c.json({ error: 'Free tier limit reached for this account', maxFree, currentFree: used }, 409);
      }
    }
  }

  // Verify service/stack belongs to this account
  if (data.serviceId) {
    const svc = await db.query.services.findFirst({
      where: and(eq(services.id, data.serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
    });
    if (!svc) return c.json({ error: 'Service not found' }, 404);
  }

  // Get or create Stripe customer
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
  });
  if (!account) return c.json({ error: 'Account not found' }, 404);

  let stripeCustomerId = account.stripeCustomerId;
  if (!stripeCustomerId) {
    const user = c.get('user');
    const customer = await stripeService.createCustomer(user.email, account.name ?? user.email);
    stripeCustomerId = customer.id;
    await db.update(accounts).set({ stripeCustomerId, updatedAt: new Date() }).where(eq(accounts.id, accountId));
  }

  try {
    const result = await stripeSyncService.createServiceCheckoutSession({
      accountId,
      serviceId: data.serviceId,
      stackId: data.stackId,
      planId: data.planId,
      billingCycle: data.billingCycle,
      currency: data.currency,
      paymentMethodId: data.paymentMethodId,
      billingContactEmail: data.billingContactEmail,
      billingContactName: data.billingContactName,
      stripeCustomerId,
      successUrl: data.successUrl,
      cancelUrl: data.cancelUrl,
    });
    return c.json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to create service checkout session');
    logToErrorTable({ level: 'error', message: `Service checkout failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'service-checkout' } });
    return c.json({ error: 'Checkout failed' }, 400);
  }
}) as any);

// GET /service-subscriptions
authed.openapi(listServiceSubscriptionsRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const subs = await db.query.subscriptions.findMany({
    where: and(
      eq(subscriptions.accountId, accountId),
      // Service subscriptions have either serviceId or stackId set
    ),
    with: { plan: true },
    orderBy: (s: any, { desc: d }: any) => d(s.createdAt),
  });

  // Filter to only service/stack subscriptions
  const serviceSubs = subs.filter((s: any) => s.serviceId || s.stackId);
  return c.json(serviceSubs);
}) as any);

// GET /service-subscriptions/:id
authed.openapi(getServiceSubscriptionRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const sub = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.id, id), eq(subscriptions.accountId, accountId)),
    with: { plan: true },
  });
  if (!sub) return c.json({ error: 'Subscription not found' }, 404);

  let stripeData = null;
  if (sub.stripeSubscriptionId) {
    try { stripeData = await stripeService.getSubscription(sub.stripeSubscriptionId); } catch { /* Stripe unavailable */ }
  }

  return c.json({ ...sub, stripeData });
}) as any);

// GET /services/:serviceId/subscription
authed.openapi(getSubscriptionForServiceRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  // Verify service ownership
  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });
  if (!svc) return c.json({ error: 'Service not found' }, 404);

  // Direct service subscription
  let sub = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.serviceId, serviceId), eq(subscriptions.accountId, accountId)),
    with: { plan: true },
  });

  // Fall back to stack subscription if service belongs to a stack
  if (!sub && svc.stackId) {
    sub = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.stackId, svc.stackId), eq(subscriptions.accountId, accountId)),
      with: { plan: true },
    });
  }

  // Fall back to account-level subscription (legacy)
  if (!sub) {
    sub = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.accountId, accountId), isNull(subscriptions.serviceId), isNull(subscriptions.stackId)),
      with: { plan: true },
      orderBy: (s: any, { desc: d }: any) => d(s.createdAt),
    });
  }

  return c.json(sub ?? null);
}) as any);

// PATCH /service-subscriptions/:id/plan
authed.openapi(changeServicePlanRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id } = c.req.valid('param');
  const { planId } = c.req.valid('json');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const sub = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.id, id), eq(subscriptions.accountId, accountId)),
  });
  if (!sub) return c.json({ error: 'Subscription not found' }, 404);
  if (!sub.stripeSubscriptionId) return c.json({ error: 'No Stripe subscription to update' }, 400);
  if (!sub.billingCycle) return c.json({ error: 'Subscription has no billing cycle' }, 400);

  const newPlan = await db.query.billingPlans.findFirst({
    where: eq(billingPlans.id, planId),
  });
  if (!newPlan) return c.json({ error: 'Plan not found' }, 404);

  const config = await db.query.billingConfig.findFirst();

  // ── Downgrade validation ────────────────────────────────────────────────
  const currentPlan = sub.planId
    ? await db.query.billingPlans.findFirst({ where: eq(billingPlans.id, sub.planId) })
    : null;

  if (currentPlan) {
    const isDowngrade =
      newPlan.cpuLimit < currentPlan.cpuLimit ||
      newPlan.memoryLimit < currentPlan.memoryLimit ||
      newPlan.containerLimit < currentPlan.containerLimit;

    if (isDowngrade && config?.allowDowngrade === false) {
      return c.json({ error: 'Downgrade is not allowed. You can only upgrade or cancel.' }, 403);
    }

    // Check if service's current resources exceed new plan limits
    if (isDowngrade && sub.serviceId) {
      const svc = await db.query.services.findFirst({
        where: eq(services.id, sub.serviceId),
      });

      if (svc) {
        const conflicts: Array<{ resource: string; current: number; planLimit: number }> = [];

        if (svc.cpuLimit != null && svc.cpuLimit > newPlan.cpuLimit) {
          conflicts.push({ resource: 'cpuLimit', current: svc.cpuLimit, planLimit: newPlan.cpuLimit });
        }
        if (svc.memoryLimit != null && svc.memoryLimit > newPlan.memoryLimit) {
          conflicts.push({ resource: 'memoryLimit', current: svc.memoryLimit, planLimit: newPlan.memoryLimit });
        }
        if (svc.replicas != null && svc.replicas > newPlan.containerLimit) {
          conflicts.push({ resource: 'replicas', current: svc.replicas, planLimit: newPlan.containerLimit });
        }

        if (conflicts.length > 0) {
          const confirm = c.req.query('confirm');
          if (confirm !== 'true') {
            return c.json({
              error: 'Service resources exceed new plan limits',
              conflicts,
              hint: 'Add ?confirm=true to auto-adjust service resources to fit the new plan',
            }, 409);
          }

          // Auto-adjust service resources to fit new plan limits
          const adjustments: Record<string, number> = {};
          const dbUpdates: Record<string, any> = { updatedAt: new Date() };

          for (const conflict of conflicts) {
            if (conflict.resource === 'cpuLimit') {
              adjustments.cpuLimit = newPlan.cpuLimit;
              dbUpdates.cpuLimit = newPlan.cpuLimit;
            } else if (conflict.resource === 'memoryLimit') {
              adjustments.memoryLimit = newPlan.memoryLimit;
              dbUpdates.memoryLimit = newPlan.memoryLimit;
            } else if (conflict.resource === 'replicas') {
              adjustments.replicas = newPlan.containerLimit;
              dbUpdates.replicas = newPlan.containerLimit;
            }
          }

          // Update service in DB
          await db.update(services).set(dbUpdates).where(eq(services.id, sub.serviceId));

          // Update Docker service if deployed
          if (svc.dockerServiceId) {
            try {
              const dockerUpdate: Record<string, any> = {};
              if (adjustments.cpuLimit != null) dockerUpdate.cpuLimit = adjustments.cpuLimit;
              if (adjustments.memoryLimit != null) dockerUpdate.memoryLimit = adjustments.memoryLimit;
              if (adjustments.replicas != null) dockerUpdate.replicas = adjustments.replicas;
              await orchestrator.updateService(svc.dockerServiceId, dockerUpdate);
            } catch (orchErr) {
              logger.error({ err: orchErr }, 'Failed to auto-adjust Docker service resources during downgrade');
              logToErrorTable({ level: 'error', message: `Failed to auto-adjust Docker service during downgrade: ${orchErr instanceof Error ? orchErr.message : String(orchErr)}`, stack: orchErr instanceof Error ? orchErr.stack : null, metadata: { context: 'billing', operation: 'downgrade-auto-adjust' } });
              return c.json({ error: 'Failed to adjust service resources for downgrade' }, 500);
            }
          }

          logger.info({ serviceId: sub.serviceId, adjustments }, 'Auto-adjusted service resources for plan downgrade');
        }
      }
    }
  }
  // ── End downgrade validation ────────────────────────────────────────────

  const cycleDiscounts = (config?.cycleDiscounts ?? {}) as Record<string, { type: string; value: number }>;
  const CYCLE_MONTHS: Record<string, number> = { daily: 1/30, weekly: 7/30, monthly: 1, quarterly: 3, half_yearly: 6, yearly: 12 };
  const CYCLE_TO_STRIPE: Record<string, { interval: 'day'|'week'|'month'|'year'; interval_count: number }> = {
    daily: { interval: 'day', interval_count: 1 }, weekly: { interval: 'week', interval_count: 1 },
    monthly: { interval: 'month', interval_count: 1 }, quarterly: { interval: 'month', interval_count: 3 },
    half_yearly: { interval: 'month', interval_count: 6 }, yearly: { interval: 'year', interval_count: 1 },
  };

  let amount = Math.round(newPlan.priceCents * (CYCLE_MONTHS[sub.billingCycle] ?? 1));
  const disc = cycleDiscounts[sub.billingCycle];
  if (disc) {
    if (disc.type === 'percentage') amount = Math.round(amount * (1 - disc.value / 100));
    else if (disc.type === 'fixed') amount = Math.max(0, amount - disc.value);
  }

  try {
    await stripeService.updateSubscriptionPlan(sub.stripeSubscriptionId, {
      currency: 'usd',
      product_data: { name: newPlan.name },
      unit_amount: amount,
      recurring: CYCLE_TO_STRIPE[sub.billingCycle],
    });

    await db.update(subscriptions).set({ planId, updatedAt: new Date() }).where(eq(subscriptions.id, id));

    // Update service plan reference
    if (sub.serviceId) {
      await db.update(services).set({ planId, updatedAt: new Date() }).where(eq(services.id, sub.serviceId));
    }

    return c.json({ message: 'Plan updated' });
  } catch (err) {
    logger.error({ err }, 'Failed to change service plan');
    logToErrorTable({ level: 'error', message: `Service plan change failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'change-service-plan' } });
    return c.json({ error: 'Failed to change plan' }, 500);
  }
}) as any);

// PATCH /service-subscriptions/:id/payment-method
authed.openapi(changeServicePaymentMethodRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id } = c.req.valid('param');
  const { paymentMethodId } = c.req.valid('json');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const sub = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.id, id), eq(subscriptions.accountId, accountId)),
  });
  if (!sub) return c.json({ error: 'Subscription not found' }, 404);
  if (!sub.stripeSubscriptionId) return c.json({ error: 'No Stripe subscription to update' }, 400);

  try {
    await stripeService.updateSubscriptionPaymentMethod(sub.stripeSubscriptionId, paymentMethodId);
    return c.json({ message: 'Payment method updated' });
  } catch (err) {
    logger.error({ err }, 'Failed to change service payment method');
    logToErrorTable({ level: 'error', message: `Service payment method change failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'change-service-payment-method' } });
    return c.json({ error: 'Failed to update payment method' }, 500);
  }
}) as any);

// PATCH /service-subscriptions/:id/contact
authed.openapi(updateServiceContactRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id } = c.req.valid('param');
  const data = c.req.valid('json');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const sub = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.id, id), eq(subscriptions.accountId, accountId)),
  });
  if (!sub) return c.json({ error: 'Subscription not found' }, 404);

  await db.update(subscriptions).set({
    paymentContactEmail: data.billingContactEmail ?? sub.paymentContactEmail,
    paymentContactName: data.billingContactName ?? sub.paymentContactName,
    updatedAt: new Date(),
  }).where(eq(subscriptions.id, id));

  return c.json({ message: 'Billing contact updated' });
}) as any);

// DELETE /service-subscriptions/:id
authed.openapi(cancelServiceSubscriptionRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const sub = await db.query.subscriptions.findFirst({
    where: and(eq(subscriptions.id, id), eq(subscriptions.accountId, accountId)),
  });
  if (!sub) return c.json({ error: 'Subscription not found' }, 404);

  if (sub.stripeSubscriptionId) {
    try {
      await stripeService.cancelSubscriptionAtPeriodEnd(sub.stripeSubscriptionId);
    } catch (err) {
      logger.error({ err }, 'Failed to cancel service Stripe subscription');
      logToErrorTable({ level: 'error', message: `Service subscription cancel failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'cancel-service-subscription' } });
      return c.json({ error: 'Failed to cancel subscription' }, 500);
    }
  }

  await db.update(subscriptions)
    .set({ cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(subscriptions.id, id));

  return c.json({ message: 'Service subscription will cancel at end of billing period' });
}) as any);

// GET /free-tier-usage
authed.openapi(freeTierUsageRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const config = await db.query.billingConfig.findFirst();
  const override = await db.query.accountBillingOverrides.findFirst({
    where: eq(accountBillingOverrides.accountId, accountId),
  });
  // Per-account override takes priority over global setting
  const limit = override?.maxFreeServices ?? config?.maxFreeServicesPerAccount ?? null;

  const freePlanIds = (await db.select({ id: billingPlans.id }).from(billingPlans).where(eq(billingPlans.isFree, true))).map(p => p.id);
  let used = 0;
  if (freePlanIds.length > 0) {
    const result = await db.select({ count: countSql() }).from(subscriptions)
      .where(and(
        eq(subscriptions.accountId, accountId),
        isNull(subscriptions.cancelledAt),
        inArray(subscriptions.planId, freePlanIds),
      ));
    used = Number(result[0]?.count ?? 0);
  }

  return c.json({ used, limit });
}) as any);

// ─── Service suspension helper ────────────────────────────────────────────────

/** Suspend a single service (e.g., after per-service payment failure). */
async function suspendSingleService(serviceId: string) {
  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), isNull(services.deletedAt)),
  });
  if (!svc || svc.status !== 'running') return;
  try {
    if (svc.dockerServiceId) {
      await orchestrator.scaleService(svc.dockerServiceId, 0);
    }
    await db.update(services)
      .set({ status: 'suspended', stoppedAt: new Date(), updatedAt: new Date() })
      .where(eq(services.id, serviceId));
  } catch (err) {
    logger.error({ err, serviceId }, 'Failed to suspend service');
    logToErrorTable({ level: 'error', message: `Failed to suspend service: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'suspend-single-service', serviceId } });
  }
}

/** Suspend all running services for an account (e.g., after payment failure). */
async function suspendAccountServices(accountId: string) {
  const accountServices = await db.query.services.findMany({
    where: and(eq(services.accountId, accountId), eq(services.status, 'running'), isNull(services.deletedAt)),
  });

  for (const svc of accountServices) {
    try {
      if (svc.dockerServiceId) {
        await orchestrator.scaleService(svc.dockerServiceId, 0);
      }
      await db.update(services)
        .set({ status: 'suspended', stoppedAt: new Date(), updatedAt: new Date() })
        .where(eq(services.id, svc.id));
    } catch (err) {
      logger.error({ err, serviceId: svc.id }, 'Failed to suspend service');
      logToErrorTable({ level: 'error', message: `Failed to suspend service: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'suspend-service', serviceId: svc.id } });
    }
  }
}

// ─── Webhook route (unauthenticated, signature-verified) ─────────────────────
// Kept as plain .post() because it reads the raw body via c.req.text()

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
    event = await stripeService.constructWebhookEvent(rawBody, signature);
  } catch (err) {
    logger.error({ err }, 'Webhook signature verification failed');
    logToErrorTable({ level: 'error', message: `Webhook signature verification failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'webhook-signature-verification' } });
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
        // With manual capture, payment_status is 'unpaid' until we capture.
        // The authorization (hold) is confirmed by checkout completing.
        const domain = session.metadata.domain!;
        const accountId = session.metadata.accountId!;
        const paymentIntentId = session.payment_intent as string;

        try {
          const { registrarService } = await import('../services/registrar.service.js');
          const { domainRegistrations: domRegTable } = await import('@fleet/db');

          // Idempotency: check if this domain is already registered for this account
          const existingRegistration = await db.query.domainRegistrations.findFirst({
            where: and(
              eq(domRegTable.domain, domain),
              eq(domRegTable.accountId, accountId),
            ),
          });

          if (existingRegistration) {
            logger.warn({ domain, accountId, registrationId: existingRegistration.id }, 'Domain already registered — skipping duplicate registration');
            if (paymentIntentId && !existingRegistration.stripePaymentId) {
              // First checkout for this registration — capture it
              try {
                await stripeService.capturePaymentIntent(paymentIntentId);
                await db.update(domRegTable)
                  .set({ stripePaymentId: paymentIntentId })
                  .where(eq(domRegTable.id, existingRegistration.id));
              } catch (captureErr) {
                logger.error({ err: captureErr, paymentIntent: paymentIntentId, domain }, 'Failed to capture payment for existing registration');
                logToErrorTable({ level: 'error', message: `Failed to capture payment for existing registration: ${captureErr instanceof Error ? captureErr.message : String(captureErr)}`, stack: captureErr instanceof Error ? captureErr.stack : null, metadata: { context: 'billing', operation: 'capture-payment-existing-registration', domain, paymentIntent: paymentIntentId } });
              }
            } else if (paymentIntentId) {
              // Duplicate checkout — another payment already captured; cancel this orphaned hold
              try {
                await stripeService.cancelPaymentIntent(paymentIntentId);
                logger.info({ paymentIntent: paymentIntentId, domain }, 'Cancelled orphaned payment authorization for duplicate domain checkout');
              } catch (cancelErr) {
                logger.warn({ err: cancelErr, paymentIntent: paymentIntentId, domain }, 'Failed to cancel orphaned payment authorization (will expire automatically)');
                logToErrorTable({ level: 'error', message: `Failed to cancel orphaned payment authorization: ${cancelErr instanceof Error ? cancelErr.message : String(cancelErr)}`, stack: cancelErr instanceof Error ? cancelErr.stack : null, metadata: { context: 'billing', operation: 'cancel-orphaned-payment-auth', domain, paymentIntent: paymentIntentId } });
              }
            }
            break;
          }

          // Look up the account owner to use real contact data for WHOIS
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

          // Register domain with the registrar
          const registration = await registrarService.registerDomain(
            domain, Number(session.metadata.years) || 1,
            contact, accountId,
          );

          // Registration succeeded — capture the authorized payment
          // This is in a separate try/catch: if capture fails, the domain IS registered
          // and we must NOT cancel the payment intent (that would give the domain away free)
          if (paymentIntentId) {
            try {
              await stripeService.capturePaymentIntent(paymentIntentId);
            } catch (captureErr) {
              // CRITICAL: Domain registered but payment not captured — alert admin for manual resolution
              logger.error({ err: captureErr, paymentIntent: paymentIntentId, domain, accountId, registrationId: registration?.id },
                'CRITICAL: Domain registered but payment capture failed — manual capture required in Stripe dashboard');
              logToErrorTable({ level: 'fatal', message: `Domain registered but payment capture failed: ${captureErr instanceof Error ? captureErr.message : String(captureErr)}`, stack: captureErr instanceof Error ? captureErr.stack : null, metadata: { context: 'billing', operation: 'domain-registration-capture-payment', domain, accountId, paymentIntent: paymentIntentId, registrationId: registration?.id } });
            }
          }

          if (registration?.id && paymentIntentId) {
            await db.update(domRegTable)
              .set({ stripePaymentId: paymentIntentId })
              .where(eq(domRegTable.id, registration.id));
          }

          logger.info({ domain, accountId, paymentIntent: paymentIntentId }, 'Domain registered and payment captured');
        } catch (err) {
          logger.error({ err, domain, accountId, paymentIntent: paymentIntentId }, 'Domain registration failed — cancelling payment authorization');
          logToErrorTable({ level: 'fatal', message: `Domain registration failed in Stripe webhook: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'domain-registration-webhook', domain, accountId, paymentIntent: paymentIntentId } });

          // Cancel the authorization hold — no charge, no fees
          if (paymentIntentId) {
            try {
              await stripeService.cancelPaymentIntent(paymentIntentId);
              logger.info({ paymentIntent: paymentIntentId, domain }, 'Payment authorization cancelled for failed domain registration');
            } catch (cancelErr) {
              logger.error({ err: cancelErr, paymentIntent: paymentIntentId, domain }, 'CRITICAL: Failed to cancel payment authorization — manual cancellation required');
              logToErrorTable({ level: 'fatal', message: `CRITICAL: Failed to cancel payment authorization for domain registration: ${cancelErr instanceof Error ? cancelErr.message : String(cancelErr)}`, stack: cancelErr instanceof Error ? cancelErr.stack : null, metadata: { context: 'billing', operation: 'cancel-payment-auth-domain-registration', domain, paymentIntent: paymentIntentId } });
            }
          }

          // Create in-app notification for the account
          try {
            const { notifications } = await import('@fleet/db');
            await db.insert(notifications).values({
              id: crypto.randomUUID(),
              accountId,
              type: 'billing',
              title: 'Domain Registration Failed',
              message: `Registration of ${domain} failed. Your card was not charged. The domain may no longer be available — please try a different domain or contact support.`,
              read: false,
            });
          } catch { /* notification is best-effort */ }

          // Email account owners about the failure
          try {
            const appUrl = await getAppUrl();
            const ownerMemberships = await db.query.userAccounts.findMany({
              where: and(eq(userAccounts.accountId, accountId), eq(userAccounts.role, 'owner')),
              with: { user: true },
            });
            for (const m of ownerMemberships) {
              if (m.user?.email) {
                queueEmail({
                  templateSlug: 'domain-registration-failed',
                  to: m.user.email,
                  variables: {
                    domain,
                    billingUrl: `${appUrl}/panel/billing`,
                  },
                  accountId,
                }).catch(() => {});
              }
            }
          } catch { /* email is best-effort */ }
        }
      } else if (session.metadata?.type === 'domain_renewal') {
        const registrationId = session.metadata.registrationId!;
        const accountId = session.metadata.accountId;
        const paymentIntentId = session.payment_intent as string;

        try {
          const { registrarService } = await import('../services/registrar.service.js');
          await registrarService.renewDomain(registrationId, Number(session.metadata.years) || 1);

          // Renewal succeeded — capture the authorized payment
          if (paymentIntentId) {
            try {
              await stripeService.capturePaymentIntent(paymentIntentId);
            } catch (captureErr) {
              logger.error({ err: captureErr, paymentIntent: paymentIntentId, registrationId },
                'CRITICAL: Domain renewed but payment capture failed — manual capture required in Stripe dashboard');
              logToErrorTable({ level: 'fatal', message: `Domain renewed but payment capture failed: ${captureErr instanceof Error ? captureErr.message : String(captureErr)}`, stack: captureErr instanceof Error ? captureErr.stack : null, metadata: { context: 'billing', operation: 'domain-renewal-capture-payment', registrationId, paymentIntent: paymentIntentId } });
            }
          }
          logger.info({ registrationId, paymentIntent: paymentIntentId }, 'Domain renewed and payment captured');
        } catch (err) {
          logger.error({ err, registrationId, paymentIntent: paymentIntentId }, 'Domain renewal failed — cancelling payment authorization');
          logToErrorTable({ level: 'fatal', message: `Domain renewal failed in Stripe webhook: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'domain-renewal-webhook', registrationId, paymentIntent: paymentIntentId } });

          // Cancel the authorization hold — no charge, no fees
          if (paymentIntentId) {
            try {
              await stripeService.cancelPaymentIntent(paymentIntentId);
              logger.info({ paymentIntent: paymentIntentId, registrationId }, 'Payment authorization cancelled for failed domain renewal');
            } catch (cancelErr) {
              logger.error({ err: cancelErr, paymentIntent: paymentIntentId, registrationId }, 'CRITICAL: Failed to cancel payment authorization — manual cancellation required');
              logToErrorTable({ level: 'fatal', message: `CRITICAL: Failed to cancel payment auth for domain renewal: ${cancelErr instanceof Error ? cancelErr.message : String(cancelErr)}`, stack: cancelErr instanceof Error ? cancelErr.stack : null, metadata: { context: 'billing', operation: 'cancel-payment-auth-domain-renewal', registrationId, paymentIntent: paymentIntentId } });
            }
          }

          // Notify account if we know which account
          if (accountId) {
            try {
              const { notifications } = await import('@fleet/db');
              await db.insert(notifications).values({
                id: crypto.randomUUID(),
                accountId,
                type: 'billing',
                title: 'Domain Renewal Failed',
                message: `Domain renewal failed. Your card was not charged. Please try again or contact support.`,
                read: false,
              });
            } catch { /* best-effort */ }
          }
        }
      } else if (
        session.metadata?.type === 'subdomain_claim_recurring' ||
        session.metadata?.type === 'subdomain_claim_onetime'
      ) {
        const claimId = session.metadata.claimId;
        if (claimId) {
          try {
            const { subdomainClaims: claimsTable } = await import('@fleet/db');
            const claim = await db.query.subdomainClaims.findFirst({
              where: eq(claimsTable.id, claimId),
              with: { sharedDomain: { columns: { domain: true } } },
            });

            if (claim && claim.status === 'pending_payment') {
              const updateData: Record<string, any> = {
                status: 'active',
                updatedAt: new Date(),
              };
              if (session.metadata.type === 'subdomain_claim_recurring' && session.subscription) {
                updateData.stripeSubscriptionId = session.subscription;
              }
              if (session.payment_intent) {
                updateData.stripePaymentId = session.payment_intent as string;
              }

              await db.update(claimsTable)
                .set(updateData)
                .where(eq(claimsTable.id, claimId));

              // Assign domain to service if specified
              const serviceId = session.metadata.serviceId;
              if (serviceId && claim.sharedDomain) {
                const fullDomain = `${claim.subdomain}.${claim.sharedDomain.domain}`;
                try {
                  await db.update(services)
                    .set({ domain: fullDomain, sslEnabled: true, updatedAt: new Date() })
                    .where(eq(services.id, serviceId));
                } catch (svcErr) {
                  logger.error({ err: svcErr, serviceId, domain: fullDomain },
                    'Failed to assign domain to service after subdomain payment');
                  logToErrorTable({ level: 'error', message: `Failed to assign domain to service after subdomain payment: ${svcErr instanceof Error ? svcErr.message : String(svcErr)}`, stack: svcErr instanceof Error ? svcErr.stack : null, metadata: { context: 'billing', operation: 'assign-domain-after-subdomain-payment', serviceId, domain: fullDomain } });
                }
              }

              logger.info({ claimId, type: session.metadata.type },
                'Subdomain claim activated after payment');
            }
          } catch (err) {
            logger.error({ err, claimId }, 'Failed to activate subdomain claim after payment');
            logToErrorTable({ level: 'error', message: `Failed to activate subdomain claim after payment: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'activate-subdomain-claim', claimId } });
          }
        }
      } else if (session.metadata?.type === 'service_subscription' && session.customer && session.subscription) {
        // Per-service/stack subscription checkout completed
        const accountId = session.metadata.accountId;
        const serviceId = session.metadata.fleetServiceId ?? null;
        const stackId = session.metadata.fleetStackId ?? null;
        const planId = session.metadata.planId ?? null;
        const billingCycle = session.metadata.billingCycle ?? 'monthly';
        const contactEmail = session.metadata.billingContactEmail ?? null;
        const contactName = session.metadata.billingContactName ?? null;

        if (accountId) {
          await safeTransaction(async (tx) => {
            // Check for existing active subscription for this service/stack
            const existingWhere = serviceId
              ? and(eq(subscriptions.serviceId, serviceId), eq(subscriptions.status, 'active'))
              : stackId
                ? and(eq(subscriptions.stackId, stackId), eq(subscriptions.status, 'active'))
                : null;

            if (existingWhere) {
              const existingSub = await tx.query.subscriptions.findFirst({ where: existingWhere });
              if (existingSub) {
                logger.warn({ accountId, serviceId, stackId, existingSubId: existingSub.id }, 'Blocked duplicate service subscription');
                return;
              }
            }

            await tx.insert(subscriptions).values({
              accountId,
              planId,
              billingModel: 'fixed',
              billingCycle,
              stripeSubscriptionId: session.subscription!,
              stripeCustomerId: session.customer!,
              serviceId,
              stackId,
              paymentContactEmail: contactEmail,
              paymentContactName: contactName,
              status: 'active',
            });

            // Store plan reference on the service for quick lookups
            if (serviceId && planId) {
              await tx.update(services).set({ planId, updatedAt: new Date() }).where(eq(services.id, serviceId));
            }
          });
        }
      } else if (session.customer && session.subscription) {
        // Legacy account-level subscription checkout
        let account: any = null;
        if (session.metadata?.accountId) {
          account = await db.query.accounts.findFirst({
            where: and(eq(accounts.id, session.metadata.accountId), isNull(accounts.deletedAt)),
          });
        }
        if (!account) {
          account = await db.query.accounts.findFirst({
            where: and(eq(accounts.stripeCustomerId, session.customer), isNull(accounts.deletedAt)),
          });
        }

        if (account) {
          const billingModel = (session.metadata?.billingModel ?? 'fixed') as string;
          const billingCycle = session.metadata?.billingCycle ?? 'monthly';
          const planId = session.metadata?.planId ?? null;
          const billedByAccountId = session.metadata?.billedByAccountId ?? null;

          // Wrap subscription creation + account update in a transaction
          await safeTransaction(async (tx) => {
            // Check for existing active subscription
            const existingSub = await tx.query.subscriptions.findFirst({
              where: and(
                eq(subscriptions.accountId, account.id),
                eq(subscriptions.status, 'active'),
                isNull(subscriptions.serviceId),
                isNull(subscriptions.stackId),
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
              billedByAccountId,
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
        metadata?: Record<string, string>;
      };

      // Handle domain renewal invoice payment
      if (invoice.metadata?.type === 'domain_renewal' && invoice.metadata.registrationId) {
        const registrationId = invoice.metadata.registrationId;
        const domain = invoice.metadata.domain ?? '';
        const accountId = invoice.metadata.accountId;

        try {
          const { registrarService } = await import('../services/registrar.service.js');
          const { domainRegistrations: domRegTable } = await import('@fleet/db');

          const registration = await db.query.domainRegistrations.findFirst({
            where: eq(domRegTable.id, registrationId),
          });

          if (!registration || registration.status !== 'active') {
            logger.warn({ registrationId, domain }, 'Domain renewal invoice paid but registration not found or not active');
            break;
          }

          // Renew with the registrar (this is where the registrar charges us)
          const updated = await registrarService.renewDomain(registrationId, Number(invoice.metadata.years) || 1);
          logger.info({ domain, registrationId, newExpiresAt: updated.expiresAt }, 'Domain renewed after Stripe payment');

          // Send confirmation email to account owners
          if (accountId) {
            const appUrl = await getAppUrl();
            const price = invoice.metadata.years
              ? `${domain} (${invoice.metadata.years} year${Number(invoice.metadata.years) > 1 ? 's' : ''})`
              : domain;
            try {
              const ownerMemberships = await db.query.userAccounts.findMany({
                where: and(eq(userAccounts.accountId, accountId), eq(userAccounts.role, 'owner')),
                with: { user: true },
              });
              for (const m of ownerMemberships) {
                if (m.user?.email) {
                  queueEmail({
                    templateSlug: 'domain-renewal-charged',
                    to: m.user.email,
                    variables: {
                      domain,
                      amount: price,
                      newExpiryDate: updated.expiresAt ? updated.expiresAt.toISOString().split('T')[0]! : 'see account',
                      manageUrl: `${appUrl}/panel/domains`,
                    },
                    accountId,
                  }).catch(() => {});
                }
              }
            } catch { /* email is best-effort */ }
          }
        } catch (err) {
          logger.error({ err, registrationId, domain }, 'Domain renewal failed after Stripe payment — manual intervention required');
          logToErrorTable({ level: 'error', message: `Domain renewal failed after Stripe payment: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'domain-renewal-after-payment', registrationId, domain } });

          // Notify account about the failure
          if (accountId) {
            try {
              const { notifications } = await import('@fleet/db');
              await db.insert(notifications).values({
                id: crypto.randomUUID(),
                accountId,
                type: 'billing',
                title: 'Domain Renewal Failed',
                message: `Payment for ${domain} was received, but the renewal with the registrar failed. Our team has been notified and will resolve this manually.`,
                read: false,
              });
            } catch { /* best-effort */ }
          }
        }
      } else if (invoice.subscription) {
        // Handle subscription invoice payment
        await db
          .update(subscriptions)
          .set({
            currentPeriodStart: invoice.period_start ? new Date(invoice.period_start * 1000) : undefined,
            currentPeriodEnd: invoice.period_end ? new Date(invoice.period_end * 1000) : undefined,
            status: 'active',
            pastDueSince: null,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.stripeSubscriptionId, invoice.subscription));

        // Auto-reactivate on successful payment
        const sub = await db.query.subscriptions.findFirst({
          where: eq(subscriptions.stripeSubscriptionId, invoice.subscription),
        });
        if (sub) {
          // Per-service subscription — reactivate only that service
          if (sub.serviceId) {
            const svc = await db.query.services.findFirst({
              where: and(eq(services.id, sub.serviceId), isNull(services.deletedAt)),
            });
            if (svc && svc.status === 'suspended') {
              await db.update(services).set({ status: 'stopped', updatedAt: new Date() }).where(eq(services.id, svc.id));
              logger.info({ serviceId: svc.id }, 'Service reactivated after successful payment (set to stopped — user must start manually)');
            }
          } else if (sub.stackId) {
            // Per-stack — reactivate suspended services in stack
            const stackSvcs = await db.query.services.findMany({
              where: and(eq(services.stackId, sub.stackId), eq(services.status, 'suspended'), isNull(services.deletedAt)),
            });
            for (const svc of stackSvcs) {
              await db.update(services).set({ status: 'stopped', updatedAt: new Date() }).where(eq(services.id, svc.id));
            }
            if (stackSvcs.length > 0) {
              logger.info({ stackId: sub.stackId, count: stackSvcs.length }, 'Stack services reactivated after successful payment');
            }
          } else {
            // Legacy account-level — reactivate account
            const account = await db.query.accounts.findFirst({
              where: and(eq(accounts.id, sub.accountId), isNull(accounts.deletedAt)),
            });
            if (account && account.status === 'suspended') {
              await db.update(accounts).set({
                status: 'active',
                suspendedAt: null,
                scheduledDeletionAt: null,
                updatedAt: new Date(),
              }).where(eq(accounts.id, account.id));

              // Send reactivation email + notification
              const appUrl = await getAppUrl();
              const ownerMembers = await db.query.userAccounts.findMany({
                where: and(eq(userAccounts.accountId, account.id), eq(userAccounts.role, 'owner')),
                with: { user: true },
              });
              for (const m of ownerMembers) {
                if (m.user?.email) {
                  await queueEmail({
                    templateSlug: 'account-reactivated',
                    to: m.user.email,
                    variables: { accountName: account.name ?? 'Your account', dashboardUrl: `${appUrl}/panel` },
                    accountId: account.id,
                  });
                }
              }

              try {
                const { notificationService } = await import('../services/notification.service.js');
                await notificationService.create(account.id, {
                  type: 'billing',
                  title: 'Account reactivated',
                  message: 'Your payment was received and your account has been reactivated. You can now restart your services.',
                });
              } catch { /* notification failure is not critical */ }

              const { eventService, EventTypes } = await import('../services/event.service.js');
              eventService.log({
                accountId: account.id,
                eventType: EventTypes.ACCOUNT_REACTIVATED,
                description: 'Account reactivated after successful payment',
                resourceType: 'account',
                resourceId: account.id,
                resourceName: account.name ?? undefined,
                source: 'system',
              });

              logger.info({ accountId: account.id }, 'Account auto-reactivated after successful payment');
            }
          }
        }
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as any;

      // Handle domain renewal invoice payment failure
      if (invoice.metadata?.type === 'domain_renewal' && invoice.metadata?.registrationId) {
        const domain = invoice.metadata.domain ?? '';
        const accountId = invoice.metadata.accountId;
        const registrationId = invoice.metadata.registrationId;

        logger.warn({ domain, registrationId, attempt: invoice.attempt_count },
          'Domain renewal payment failed');

        if (accountId) {
          const appUrl = await getAppUrl();
          try {
            const ownerMemberships = await db.query.userAccounts.findMany({
              where: and(eq(userAccounts.accountId, accountId), eq(userAccounts.role, 'owner')),
              with: { user: true },
            });
            for (const m of ownerMemberships) {
              if (m.user?.email) {
                queueEmail({
                  templateSlug: 'domain-renewal-failed',
                  to: m.user.email,
                  variables: {
                    domain,
                    expiryDate: invoice.metadata.expiryDate ?? 'soon',
                    billingUrl: `${appUrl}/panel/billing`,
                  },
                  accountId,
                }).catch(() => {});
              }
            }
          } catch { /* email is best-effort */ }

          try {
            const { notifications } = await import('@fleet/db');
            await db.insert(notifications).values({
              id: crypto.randomUUID(),
              accountId,
              type: 'billing',
              title: 'Domain Renewal Payment Failed',
              message: `Payment for domain renewal of ${domain} failed. Please update your payment method to avoid losing the domain.`,
              read: false,
            });
          } catch { /* best-effort */ }
        }
        break;
      }

      const subId = invoice.subscription as string;
      if (!subId) break;

      const dbSub = await db.query.subscriptions.findFirst({
        where: eq(subscriptions.stripeSubscriptionId, subId),
      });
      if (!dbSub) break;

      const isServiceSub = !!(dbSub.serviceId || dbSub.stackId);

      if (!invoice.next_payment_attempt) {
        // Final attempt failed — mark as past_due
        await db.update(subscriptions)
          .set({
            status: 'past_due',
            pastDueSince: new Date(),
            updatedAt: new Date()
          })
          .where(eq(subscriptions.id, dbSub.id));

        const scopeLabel = dbSub.serviceId ? 'service' : dbSub.stackId ? 'stack' : 'account';
        logger.warn({ accountId: dbSub.accountId, subscriptionId: dbSub.id, scope: scopeLabel },
          `Final payment attempt failed — ${scopeLabel} subscription marked past_due (7-day grace period)`);

        // Create a notification for the account owner
        try {
          const { notifications } = await import('@fleet/db');
          const msg = isServiceSub
            ? 'Payment for a service subscription has failed after all retry attempts. Please update the payment method within 7 days to avoid service suspension.'
            : 'Your payment has failed after all retry attempts. Please update your payment method within 7 days to avoid service suspension.';
          await db.insert(notifications).values({
            id: crypto.randomUUID(),
            accountId: dbSub.accountId,
            type: 'billing',
            title: 'Payment Failed',
            message: msg,
            read: false,
          });
        } catch { /* notification is best-effort */ }

        // Send payment-failed email to account owners
        try {
          const appUrl = await getAppUrl();
          const ownerMemberships = await db.query.userAccounts.findMany({
            where: and(eq(userAccounts.accountId, dbSub.accountId), eq(userAccounts.role, 'owner')),
            with: { user: true },
          });
          for (const m of ownerMemberships) {
            if (m.user?.email) {
              queueEmail({
                templateSlug: 'payment-failed',
                to: m.user.email,
                variables: {
                  planName: dbSub.planId ?? 'your',
                  billingUrl: `${appUrl}/panel/billing`,
                },
                accountId: dbSub.accountId,
              }).catch(() => {});
            }
          }
        } catch { /* email is best-effort */ }
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

        if (dbSub.serviceId) {
          // Per-service subscription — only suspend that service
          await suspendSingleService(dbSub.serviceId);
          logger.info({ serviceId: dbSub.serviceId }, 'Service subscription cancelled — service suspended');
        } else if (dbSub.stackId) {
          // Per-stack subscription — suspend all services in the stack
          const stackServices = await db.query.services.findMany({
            where: and(eq(services.stackId, dbSub.stackId), eq(services.status, 'running'), isNull(services.deletedAt)),
          });
          for (const svc of stackServices) {
            await suspendSingleService(svc.id);
          }
          logger.info({ stackId: dbSub.stackId, count: stackServices.length }, 'Stack subscription cancelled — stack services suspended');
        } else {
          // Legacy account-level subscription — suspend all services
          await suspendAccountServices(dbSub.accountId);
          logger.info({ accountId: dbSub.accountId }, 'Account subscription cancelled — services suspended');
        }
      }

      // Also check for subdomain claim subscriptions
      try {
        const { subdomainClaims: claimsTable } = await import('@fleet/db');
        const claimWithSub = await db.query.subdomainClaims.findFirst({
          where: eq(claimsTable.stripeSubscriptionId, sub.id),
        });

        if (claimWithSub) {
          // Clear service domain if assigned
          if (claimWithSub.serviceId) {
            try {
              await db.update(services)
                .set({ domain: null, updatedAt: new Date() })
                .where(eq(services.id, claimWithSub.serviceId));
            } catch { /* best-effort */ }
          }

          await db.update(claimsTable)
            .set({ status: 'expired', updatedAt: new Date() })
            .where(eq(claimsTable.id, claimWithSub.id));

          logger.info({ claimId: claimWithSub.id, subdomain: claimWithSub.subdomain },
            'Subdomain claim expired — subscription cancelled');
        }
      } catch (err) {
        logger.error({ err }, 'Failed to check subdomain claim subscription cancellation');
        logToErrorTable({ level: 'error', message: `Failed to check subdomain claim subscription cancellation: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing', operation: 'check-subdomain-claim-cancellation' } });
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

    case 'checkout.session.expired': {
      const expiredSession = event.data.object as { metadata?: Record<string, string> };
      // Clean up pending subdomain claims when checkout expires
      if (expiredSession.metadata?.type?.startsWith('subdomain_claim_') && expiredSession.metadata.claimId) {
        try {
          const { subdomainClaims: claimsTable } = await import('@fleet/db');
          await db.delete(claimsTable)
            .where(and(
              eq(claimsTable.id, expiredSession.metadata.claimId),
              eq(claimsTable.status, 'pending_payment'),
            ));
          logger.info({ claimId: expiredSession.metadata.claimId },
            'Cleaned up pending subdomain claim after checkout expiry');
        } catch { /* best-effort cleanup */ }
      }
      break;
    }

    case 'charge.refunded': {
      const refundCharge = event.data.object as any;
      logger.info({ chargeId: refundCharge.id, amount: refundCharge.amount_refunded },
        'Charge refunded');
      break;
    }

    default:
      logger.info({ eventType: event.type }, 'Unhandled Stripe webhook event type');
      break;
  }

  return c.json({ received: true });
});

// ── Public routes (no auth required) ──────────────────────────────────────────

const publicCurrenciesRoute = createRoute({
  method: 'get',
  path: '/public/currencies',
  tags: ['Billing'],
  summary: 'Get allowed currencies (public, no auth)',
  responses: {
    200: jsonContent(z.object({ currencies: z.array(z.string()) }), 'Allowed currencies'),
    ...standardErrors,
  },
});

billing.openapi(publicCurrenciesRoute, (async (c: any) => {
  const currencies = await currencyService.getAllowed();
  return c.json({ currencies });
}) as any);

const publicPlansRoute = createRoute({
  method: 'get',
  path: '/public/plans',
  tags: ['Billing'],
  summary: 'List visible billing plans (public, no auth)',
  request: {
    query: z.object({
      currency: z.string().length(3).optional().openapi({ description: 'Target currency code (e.g. NOK, EUR). Converts prices from USD.' }),
    }),
  },
  responses: {
    200: jsonContent(z.object({
      plans: z.array(z.any()),
      allowedCycles: z.array(z.string()).optional(),
      trialDays: z.number().optional(),
      currency: z.string().optional(),
    }), 'Public plans list'),
  },
});

billing.openapi(publicPlansRoute, (async (c: any) => {
  const { currency: targetCurrency } = c.req.valid('query');

  // Validate currency against allowed list
  if (targetCurrency) {
    const allowed = await currencyService.validateCurrency(targetCurrency);
    if (!allowed) {
      return c.json({ error: `Currency ${targetCurrency} is not available` }, 400);
    }
  }

  const plans = await db.query.billingPlans.findMany({
    where: eq(billingPlans.visible, true),
    orderBy: (p: any, { asc }: any) => asc(p.sortOrder),
    with: { prices: true },
  });

  // Strip sensitive Stripe fields and prices relation
  const safePlans = plans.map(({ stripeProductId, stripePriceIds, prices, ...rest }: any) => ({
    ...rest,
    _currencyPrices: prices,
  }));

  // Apply per-currency pricing: use fixed price if set, otherwise convert from USD
  const tc = targetCurrency?.toUpperCase() ?? 'USD';
  for (const plan of safePlans) {
    const fixedPrice = plan._currencyPrices?.find((p: any) => p.currency === tc);
    if (fixedPrice) {
      plan.priceCents = fixedPrice.priceCents;
    } else if (tc !== 'USD' && plan.priceCents != null) {
      plan.priceCents = await exchangeRateService.convertCents(plan.priceCents, 'USD', tc);
    }
    // Convert yearly price if set and not USD
    if (tc !== 'USD' && plan.yearlyPriceCents != null) {
      plan.yearlyPriceCents = await exchangeRateService.convertCents(plan.yearlyPriceCents, 'USD', tc);
    }
    delete plan._currencyPrices;
  }

  // Include billing config for cycle/trial info
  let allowedCycles: string[] | undefined;
  let trialDays: number | undefined;
  try {
    const config = await db.query.billingConfig.findFirst();
    if (config) {
      allowedCycles = (config.allowedCycles as string[]) ?? undefined;
      trialDays = config.trialDays ?? undefined;
    }
  } catch {
    // Billing config may not exist yet
  }

  return c.json({ plans: safePlans, allowedCycles, trialDays, currency: tc });
}) as any);

// ─── Exchange Rate endpoints (admin, on authed sub-router) ────────────────────

const getExchangeRatesRoute = createRoute({
  method: 'get',
  path: '/exchange-rates',
  tags: ['Billing'],
  summary: 'Get cached exchange rates',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      baseCurrency: z.string(),
      rates: z.record(z.string(), z.number()),
      updatedAt: z.string(),
    }), 'Exchange rates'),
    ...standardErrors,
  },
});

authed.openapi(getExchangeRatesRoute, (async (c: any) => {
  const rates = await exchangeRateService.getRates();
  return c.json(rates);
}) as any);

const refreshExchangeRatesRoute = createRoute({
  method: 'post',
  path: '/exchange-rates/refresh',
  tags: ['Billing'],
  summary: 'Force-fetch fresh exchange rates',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      baseCurrency: z.string(),
      rates: z.record(z.string(), z.number()),
      updatedAt: z.string(),
    }), 'Refreshed exchange rates'),
    ...standardErrors,
  },
  middleware: [requireScope('billing:manage')],
});

authed.openapi(refreshExchangeRatesRoute, (async (c: any) => {
  const rates = await exchangeRateService.refreshRates();
  return c.json(rates);
}) as any);

const updateExchangeRatesRoute = createRoute({
  method: 'put',
  path: '/exchange-rates',
  tags: ['Billing'],
  summary: 'Manually override exchange rates',
  security: bearerSecurity,
  request: {
    body: jsonBody(z.object({
      rates: z.record(z.string(), z.number()).openapi({ description: 'Currency code to rate mapping (base: USD)' }),
    })),
  },
  responses: {
    200: jsonContent(z.object({
      baseCurrency: z.string(),
      rates: z.record(z.string(), z.number()),
      updatedAt: z.string(),
    }), 'Updated exchange rates'),
    ...standardErrors,
  },
  middleware: [requireScope('billing:manage')],
});

authed.openapi(updateExchangeRatesRoute, (async (c: any) => {
  const { rates } = c.req.valid('json');
  const result = await exchangeRateService.setRates(rates);
  return c.json(result);
}) as any);

billing.route('/', authed);

export default billing;
