import { Hono } from 'hono';
import { z } from 'zod';
import {
  db,
  accounts,
  billingPlans,
  subscriptions,
  usageRecords,
  eq,
  and,
} from '@hoster/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { stripeService } from '../services/stripe.service.js';

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

// GET /plans — list billing plans for the current account
authed.get('/plans', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const plans = await db.query.billingPlans.findMany({
    where: eq(billingPlans.accountId, accountId),
    orderBy: (p, { asc }) => asc(p.priceCents),
  });

  return c.json(plans);
});

// POST /checkout — create a Stripe Checkout session
const checkoutSchema = z.object({
  planId: z.string().uuid(),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

authed.post('/checkout', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const { planId, successUrl, cancelUrl } = parsed.data;

  // Look up the plan to get the Stripe price ID
  const plan = await db.query.billingPlans.findFirst({
    where: and(eq(billingPlans.id, planId), eq(billingPlans.accountId, accountId)),
  });

  if (!plan) {
    return c.json({ error: 'Plan not found' }, 404);
  }

  if (!plan.stripePriceId) {
    return c.json({ error: 'Plan does not have a Stripe price configured' }, 400);
  }

  // Get the account's Stripe customer ID, or create one
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });

  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  let stripeCustomerId = account.stripeCustomerId;

  if (!stripeCustomerId) {
    const user = c.get('user');
    const customer = await stripeService.createCustomer(
      user.email,
      account.name ?? user.email,
    );
    stripeCustomerId = customer.id;

    await db
      .update(accounts)
      .set({ stripeCustomerId, updatedAt: new Date() })
      .where(eq(accounts.id, accountId));
  }

  const session = await stripeService.createCheckoutSession(
    stripeCustomerId,
    plan.stripePriceId,
    successUrl,
    cancelUrl,
  );

  return c.json({ url: session.url });
});

// GET /subscription — current subscription for the account
authed.get('/subscription', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const sub = await db.query.subscriptions.findFirst({
    where: and(
      eq(subscriptions.accountId, accountId),
      eq(subscriptions.status, 'active'),
    ),
    with: { plan: true },
  });

  if (!sub) {
    return c.json({ error: 'No active subscription found' }, 404);
  }

  // Optionally enrich with live Stripe data
  let stripeData = null;
  if (sub.stripeSubscriptionId) {
    try {
      stripeData = await stripeService.getSubscription(sub.stripeSubscriptionId);
    } catch {
      // Stripe may be unavailable; return local data only
    }
  }

  return c.json({ ...sub, stripeData });
});

// GET /usage — current usage stats for the account
authed.get('/usage', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const latestUsage = await db.query.usageRecords.findFirst({
    where: eq(usageRecords.accountId, accountId),
    orderBy: (u, { desc: d }) => d(u.recordedAt),
  });

  if (!latestUsage) {
    return c.json({
      containers: 0,
      cpuSeconds: 0,
      memoryMbHours: 0,
      storageGb: 0,
      recordedAt: null,
    });
  }

  return c.json(latestUsage);
});

// GET /invoices — invoice history from Stripe
authed.get('/invoices', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
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
    console.error('Failed to fetch invoices from Stripe:', err);
    return c.json({ error: 'Failed to fetch invoices' }, 500);
  }
});

// POST /portal — create a Stripe customer billing portal session
const portalSchema = z.object({
  returnUrl: z.string().url(),
});

authed.post('/portal', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = portalSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
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
    console.error('Webhook signature verification failed:', err);
    return c.json({ error: 'Invalid signature' }, 400);
  }

  // Handle the event
  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as { customer?: string; subscription?: string };
      if (session.customer && session.subscription) {
        // Find the account by Stripe customer ID and create a local subscription record
        const account = await db.query.accounts.findFirst({
          where: eq(accounts.stripeCustomerId, session.customer),
        });

        if (account) {
          // Find the first plan for this account to associate with the subscription
          const plan = await db.query.billingPlans.findFirst({
            where: eq(billingPlans.accountId, account.id),
          });

          if (plan) {
            await db.insert(subscriptions).values({
              accountId: account.id,
              planId: plan.id,
              stripeSubscriptionId: session.subscription,
              status: 'active',
            });
          }
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object as { id?: string; status?: string };
      if (sub.id) {
        const statusMap: Record<string, string> = {
          active: 'active',
          past_due: 'past_due',
          canceled: 'cancelled',
          unpaid: 'past_due',
        };
        const mappedStatus = statusMap[sub.status ?? ''] ?? sub.status ?? 'active';

        await db
          .update(subscriptions)
          .set({ status: mappedStatus, updatedAt: new Date() })
          .where(eq(subscriptions.stripeSubscriptionId, sub.id));
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object as { id?: string };
      if (sub.id) {
        await db
          .update(subscriptions)
          .set({ status: 'cancelled', updatedAt: new Date() })
          .where(eq(subscriptions.stripeSubscriptionId, sub.id));
      }
      break;
    }

    default:
      // Unhandled event type — acknowledge receipt
      break;
  }

  return c.json({ received: true });
});

// Mount authenticated routes under the billing router
billing.route('/', authed);

export default billing;
