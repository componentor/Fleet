import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, domainRegistrations, domainTldPricing, accounts, eq, and, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { registrarService } from '../services/registrar.service.js';
import { stripeService } from '../services/stripe.service.js';
import { requireAdmin } from '../middleware/rbac.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { logger } from '../services/logger.js';
import { getAppUrlSync } from '../services/platform.service.js';
import { jsonBody, jsonContent, errorResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

const searchRateLimit = rateLimiter({ windowMs: 60 * 1000, max: 20, keyPrefix: 'domain-search' });

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

const domainPurchase = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

domainPurchase.use('*', authMiddleware);
domainPurchase.use('*', tenantMiddleware);

// ── Schemas ──

const searchQuerySchema = z.object({
  q: z.string().min(1).openapi({ description: 'Domain search query' }),
  tlds: z.string().optional().openapi({ description: 'Comma-separated list of TLDs to filter' }),
});

const checkoutSchema = z.object({
  domain: z.string().min(3).max(253).regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/),
  years: z.number().int().min(1).max(10).default(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
}).openapi('DomainCheckoutRequest');

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
}).openapi('RegisterDomainRequest');

const renewCheckoutSchema = z.object({
  years: z.number().int().min(1).max(10).default(1),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
}).openapi('RenewCheckoutRequest');

const renewSchema = z.object({
  years: z.number().int().min(1).max(10).default(1),
}).openapi('RenewDomainRequest');

const idParamSchema = z.object({
  id: z.string().openapi({ description: 'Domain registration ID' }),
});

const searchResultSchema = z.object({
  query: z.string(),
  results: z.array(z.any()),
}).openapi('DomainSearchResponse');

const checkoutResponseSchema = z.object({
  url: z.string().nullable(),
}).openapi('CheckoutResponse');

const execOutputSchema = z.object({
  output: z.string(),
}).openapi('ExecOutput');

// ────────────────────────────────────────────────────────────────────────────
// GET /search — search available domains (with TLD pricing overlay)
// ────────────────────────────────────────────────────────────────────────────
const searchRoute = createRoute({
  method: 'get',
  path: '/search',
  tags: ['Domain Purchase'],
  summary: 'Search available domains',
  security: bearerSecurity,
  request: {
    query: searchQuerySchema,
  },
  responses: {
    200: jsonContent(searchResultSchema, 'Domain search results'),
    ...standardErrors,
  },
  middleware: [searchRateLimit],
});

domainPurchase.openapi(searchRoute, (async (c: any) => {
  const { q: query, tlds: tldsParam } = c.req.valid('query');

  const tlds = tldsParam
    ? tldsParam.split(',').map((t: string) => t.trim().toLowerCase())
    : [];

  try {
    const results = await registrarService.searchDomains(query.trim(), tlds);

    // Overlay with sell prices from domainTldPricing
    const pricingEntries = await db.query.domainTldPricing.findMany();
    const pricingMap = new Map(pricingEntries.map((p: any) => [p.tld, p]));

    const enriched = results
      .map((r: any) => {
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
        details: undefined,
      },
      500,
    );
  }
}) as any);

// ────────────────────────────────────────────────────────────────────────────
// POST /checkout — create Stripe checkout session for domain purchase
// ────────────────────────────────────────────────────────────────────────────
const checkoutRoute = createRoute({
  method: 'post',
  path: '/checkout',
  tags: ['Domain Purchase'],
  summary: 'Create Stripe checkout session for domain purchase',
  security: bearerSecurity,
  request: {
    body: jsonBody(checkoutSchema),
  },
  responses: {
    200: jsonContent(checkoutResponseSchema, 'Checkout session URL'),
    ...standardErrors,
  },
  middleware: [requireAdmin],
});

domainPurchase.openapi(checkoutRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { domain, years, successUrl, cancelUrl } = c.req.valid('json');

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
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
  });

  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  try {
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
  } catch (err: any) {
    logger.error({ err, domain, accountId, priceInCents }, 'Domain checkout failed');
    return c.json({ error: err?.message || 'Failed to create checkout session' }, 500);
  }
}) as any);

// ────────────────────────────────────────────────────────────────────────────
// POST /register — direct register (for non-Stripe flows or after webhook)
// ────────────────────────────────────────────────────────────────────────────
const registerRoute = createRoute({
  method: 'post',
  path: '/register',
  tags: ['Domain Purchase'],
  summary: 'Register a domain directly (super admin only)',
  security: bearerSecurity,
  request: {
    body: jsonBody(registerDomainSchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Domain registration result'),
    ...standardErrors,
  },
  middleware: [requireAdmin],
});

domainPurchase.openapi(registerRoute, (async (c: any) => {
  const user = c.get('user');
  // Direct registration bypasses Stripe — restrict to super admins only
  if (!user.isSuper) {
    return c.json({ error: 'Only platform administrators can register domains directly' }, 403);
  }

  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { domain, years, contact } = c.req.valid('json');

  logger.info({ domain, years, accountId, initiatedBy: user.userId }, 'Direct domain registration initiated by super admin (bypasses Stripe)');

  try {
    const registration = await registrarService.registerDomain(
      domain.toLowerCase(),
      years,
      contact,
      accountId,
    );

    logger.info({ domain, accountId, registrationId: registration.id, initiatedBy: user.userId }, 'Direct domain registration completed');
    return c.json(registration, 201);
  } catch (err) {
    logger.error({ err, domain, accountId, initiatedBy: user.userId }, 'Direct domain registration failed');
    return c.json(
      {
        error: 'Domain registration failed',
        details: undefined,
      },
      500,
    );
  }
}) as any);

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/renew-checkout — create Stripe checkout for domain renewal
// ────────────────────────────────────────────────────────────────────────────
const renewCheckoutRoute = createRoute({
  method: 'post',
  path: '/{id}/renew-checkout',
  tags: ['Domain Purchase'],
  summary: 'Create Stripe checkout session for domain renewal',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonBody(renewCheckoutSchema),
  },
  responses: {
    200: jsonContent(checkoutResponseSchema, 'Checkout session URL'),
    ...standardErrors,
  },
  middleware: [requireAdmin],
});

domainPurchase.openapi(renewCheckoutRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: registrationId } = c.req.valid('param');

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

  const { years, successUrl, cancelUrl } = c.req.valid('json');

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
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
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
}) as any);

// ────────────────────────────────────────────────────────────────────────────
// POST /:id/renew — direct renew (for non-Stripe or after webhook)
// ────────────────────────────────────────────────────────────────────────────
const renewRoute = createRoute({
  method: 'post',
  path: '/{id}/renew',
  tags: ['Domain Purchase'],
  summary: 'Renew a domain directly (super admin only)',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonBody(renewSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated domain registration'),
    ...standardErrors,
  },
  middleware: [requireAdmin],
});

domainPurchase.openapi(renewRoute, (async (c: any) => {
  const user = c.get('user');
  // Direct renewal bypasses Stripe — restrict to super admins only
  if (!user.isSuper) {
    return c.json({ error: 'Only platform administrators can renew domains directly' }, 403);
  }

  const accountId = c.get('accountId');
  const { id: registrationId } = c.req.valid('param');

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

  const { years } = c.req.valid('json');

  try {
    const updated = await registrarService.renewDomain(
      registrationId,
      years,
    );

    return c.json(updated);
  } catch (err) {
    logger.error({ err }, 'Domain renewal failed');
    return c.json(
      {
        error: 'Domain renewal failed',
        details: undefined,
      },
      500,
    );
  }
}) as any);

// ────────────────────────────────────────────────────────────────────────────
// GET /registrations — list purchased domains for the current account
// ────────────────────────────────────────────────────────────────────────────
const listRegistrationsRoute = createRoute({
  method: 'get',
  path: '/registrations',
  tags: ['Domain Purchase'],
  summary: 'List purchased domains for the current account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.any()), 'List of domain registrations'),
    ...standardErrors,
  },
});

domainPurchase.openapi(listRegistrationsRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const registrations = await registrarService.listRegistrations(accountId);
  return c.json(registrations);
}) as any);

export default domainPurchase;
