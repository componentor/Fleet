import { Hono } from 'hono';
import { z } from 'zod';
import { db, domainRegistrations, domainTldPricing, accounts, eq, and } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { registrarService } from '../services/registrar.service.js';
import { stripeService } from '../services/stripe.service.js';
import { requireAdmin } from '../middleware/rbac.js';
import { logger } from '../services/logger.js';

/** Validate that a redirect URL belongs to the app's origin (prevents open redirects via Stripe). */
function validateRedirectUrl(url: string): boolean {
  const appUrl = process.env['APP_URL'];
  if (!appUrl) return true; // Dev mode — allow any URL
  if (url.startsWith('/')) return true; // Relative path
  try {
    const parsed = new URL(url);
    const app = new URL(appUrl);
    return parsed.origin === app.origin;
  } catch {
    return false;
  }
}

const domainPurchase = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

domainPurchase.use('*', authMiddleware);
domainPurchase.use('*', tenantMiddleware);

// ────────────────────────────────────────────────────────────────────────────
// GET /search — search available domains (with TLD pricing overlay)
// ────────────────────────────────────────────────────────────────────────────
domainPurchase.get('/search', async (c) => {
  const query = c.req.query('q');

  if (!query || query.trim().length === 0) {
    return c.json({ error: 'Query parameter "q" is required' }, 400);
  }

  const tldsParam = c.req.query('tlds');
  const tlds = tldsParam
    ? tldsParam.split(',').map((t) => t.trim().toLowerCase())
    : [];

  try {
    const results = await registrarService.searchDomains(query.trim(), tlds);

    // Overlay with sell prices from domainTldPricing
    const pricingEntries = await db.query.domainTldPricing.findMany();
    const pricingMap = new Map(pricingEntries.map((p) => [p.tld, p]));

    const enriched = results
      .map((r) => {
        const tld = r.domain.split('.').slice(1).join('.');
        const pricing = pricingMap.get(tld);

        if (pricing) {
          // Only show TLDs that are enabled
          if (!pricing.enabled) return null;

          return {
            ...r,
            price: {
              registration: pricing.sellRegistrationPrice / 100,
              renewal: pricing.sellRenewalPrice / 100,
              currency: pricing.currency,
            },
          };
        }

        // No pricing configured — show provider price as-is
        return r;
      })
      .filter(Boolean);

    return c.json({ query: query.trim(), results: enriched });
  } catch (err) {
    logger.error({ err }, 'Domain search failed');
    return c.json(
      {
        error: 'Domain search failed',
        details: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /checkout — create Stripe checkout session for domain purchase
// ────────────────────────────────────────────────────────────────────────────
const checkoutSchema = z.object({
  domain: z.string().min(3).max(253).regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/),
  years: z.number().int().min(1).max(10).default(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

domainPurchase.post('/checkout', requireAdmin, async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = checkoutSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { domain, years, successUrl, cancelUrl } = parsed.data;

  // Validate redirect URLs against APP_URL to prevent open redirects
  if (!validateRedirectUrl(successUrl) || !validateRedirectUrl(cancelUrl)) {
    return c.json({ error: 'Invalid redirect URL: must match application origin' }, 400);
  }

  const tld = domain.split('.').slice(1).join('.').toLowerCase();

  // Look up sell price
  const pricing = await db.query.domainTldPricing.findFirst({
    where: eq(domainTldPricing.tld, tld),
  });

  if (!pricing || !pricing.enabled) {
    return c.json({ error: `Domain TLD .${tld} is not available for purchase` }, 400);
  }

  const priceInCents = pricing.sellRegistrationPrice * years;

  // Get or create Stripe customer
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
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

  // Create Stripe checkout session
  const session = await stripeService.createDomainCheckoutSession(
    stripeCustomerId,
    domain,
    priceInCents,
    pricing.currency,
    years,
    accountId,
    successUrl,
    cancelUrl,
  );

  return c.json({ url: session.url });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /register — direct register (for non-Stripe flows or after webhook)
// ────────────────────────────────────────────────────────────────────────────
const registerDomainSchema = z.object({
  domain: z.string().min(3).max(253),
  years: z.number().int().min(1).max(10).default(1),
  contact: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
    address1: z.string().min(1),
    address2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().min(1),
    postalCode: z.string().min(1),
    country: z.string().length(2),
    organization: z.string().optional(),
  }),
});

domainPurchase.post('/register', requireAdmin, async (c) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = registerDomainSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { domain, years, contact } = parsed.data;

  try {
    const registration = await registrarService.registerDomain(
      domain.toLowerCase(),
      years,
      contact,
      accountId,
    );

    return c.json(registration, 201);
  } catch (err) {
    logger.error({ err }, 'Domain registration failed');
    return c.json(
      {
        error: 'Domain registration failed',
        details: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/renew-checkout — create Stripe checkout for domain renewal
// ────────────────────────────────────────────────────────────────────────────
const renewCheckoutSchema = z.object({
  years: z.number().int().min(1).max(10).default(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

domainPurchase.post('/:id/renew-checkout', requireAdmin, async (c) => {
  const accountId = c.get('accountId');
  const registrationId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const existing = await db.query.domainRegistrations.findFirst({
    where: and(
      eq(domainRegistrations.id, registrationId),
      eq(domainRegistrations.accountId, accountId),
    ),
  });

  if (!existing) {
    return c.json({ error: 'Domain registration not found' }, 404);
  }

  const body = await c.req.json();
  const parsed = renewCheckoutSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { years, successUrl, cancelUrl } = parsed.data;

  // Validate redirect URLs against APP_URL to prevent open redirects
  if (!validateRedirectUrl(successUrl) || !validateRedirectUrl(cancelUrl)) {
    return c.json({ error: 'Invalid redirect URL: must match application origin' }, 400);
  }

  const tld = existing.domain.split('.').slice(1).join('.');

  const pricing = await db.query.domainTldPricing.findFirst({
    where: eq(domainTldPricing.tld, tld),
  });

  const priceInCents = pricing
    ? pricing.sellRenewalPrice * years
    : 1499 * years; // Fallback

  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, accountId),
  });

  if (!account?.stripeCustomerId) {
    return c.json({ error: 'No Stripe customer configured' }, 400);
  }

  const session = await stripeService.createDomainCheckoutSession(
    account.stripeCustomerId,
    existing.domain,
    priceInCents,
    pricing?.currency ?? 'USD',
    years,
    accountId,
    successUrl,
    cancelUrl,
    registrationId,
  );

  return c.json({ url: session.url });
});

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/renew — direct renew (for non-Stripe or after webhook)
// ────────────────────────────────────────────────────────────────────────────
const renewSchema = z.object({
  years: z.number().int().min(1).max(10).default(1),
});

domainPurchase.post('/:id/renew', requireAdmin, async (c) => {
  const accountId = c.get('accountId');
  const registrationId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const existing = await db.query.domainRegistrations.findFirst({
    where: and(
      eq(domainRegistrations.id, registrationId),
      eq(domainRegistrations.accountId, accountId),
    ),
  });

  if (!existing) {
    return c.json({ error: 'Domain registration not found' }, 404);
  }

  const body = await c.req.json();
  const parsed = renewSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  try {
    const updated = await registrarService.renewDomain(
      registrationId,
      parsed.data.years,
    );

    return c.json(updated);
  } catch (err) {
    logger.error({ err }, 'Domain renewal failed');
    return c.json(
      {
        error: 'Domain renewal failed',
        details: err instanceof Error ? err.message : String(err),
      },
      500,
    );
  }
});

// ────────────────────────────────────────────────────────────────────────────
// GET /registrations — list purchased domains for the current account
// ────────────────────────────────────────────────────────────────────────────
domainPurchase.get('/registrations', async (c) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const registrations = await registrarService.listRegistrations(accountId);
  return c.json(registrations);
});

export default domainPurchase;
