import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, domainRegistrations, domainTldPricing, domainTldCurrencyPrices, accounts, billingConfig, eq, and, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { registrarService } from '../services/registrar.service.js';
import { stripeService } from '../services/stripe.service.js';
import { requireAdmin } from '../middleware/rbac.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { logger } from '../services/logger.js';
import { exchangeRateService } from '../services/exchange-rate.service.js';
import { getAppUrlSync } from '../services/platform.service.js';
import { jsonBody, jsonContent, errorResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

const searchRateLimit = rateLimiter({ windowMs: 60 * 1000, max: 20, keyPrefix: 'domain-search' });

// ── TLD pricing cache (avoids DB query on every search) ──
const POPULAR_TLDS = ['com', 'net', 'org', 'io', 'dev', 'app', 'co', 'me'];
const MAX_SEARCH_TLDS = 12;
let _tldPricingCache: { entries: any[]; currencyPrices: any[]; ts: number } | null = null;

async function getCachedTldPricing() {
  if (_tldPricingCache && Date.now() - _tldPricingCache.ts < 60_000) return _tldPricingCache;
  const [entries, currencyPrices] = await Promise.all([
    db.query.domainTldPricing.findMany(),
    db.query.domainTldCurrencyPrices.findMany(),
  ]);
  _tldPricingCache = { entries, currencyPrices, ts: Date.now() };
  return _tldPricingCache;
}

/** Get the configured max registration years (default 10). */
async function getDomainMaxYears(): Promise<number> {
  try {
    const config = await db.query.billingConfig.findFirst();
    return (config as any)?.domainMaxYears ?? 10;
  } catch {
    return 10;
  }
}
const publicSearchRateLimit = rateLimiter({ windowMs: 60 * 1000, max: 10, keyPrefix: 'public-domain-search' });

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

// Authed sub-router — all routes that require authentication
const authed = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

authed.use('*', authMiddleware);
authed.use('*', tenantMiddleware);

// ── Schemas ──

const searchQuerySchema = z.object({
  q: z.string().min(1).openapi({ description: 'Domain search query' }),
  tlds: z.string().optional().openapi({ description: 'Comma-separated list of TLDs to filter' }),
  currency: z.string().length(3).optional().openapi({ description: 'Target currency code (e.g. NOK, EUR)' }),
});

const checkoutSchema = z.object({
  domain: z.string().min(3).max(253).regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/),
  years: z.number().int().min(1).max(10).default(1),
  currency: z.string().length(3).optional().openapi({ description: 'Charge in this currency (e.g. NOK, EUR). Defaults to TLD pricing currency.' }),
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

// ── Shared search handler ──

async function handleDomainSearch(c: any) {
  const { q: query, tlds: tldsParam, currency: targetCurrency } = c.req.valid('query');

  const trimmed = query.trim().toLowerCase();

  // Extract the SLD (the part before any TLD) — if empty, there's nothing to search
  const sld = trimmed
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('.')[0]
    ?.replace(/[^a-z0-9-]/g, '') ?? '';

  if (!sld) {
    return c.json({ query: trimmed, results: [] });
  }

  // Only search TLDs we have enabled in domainTldPricing — these are the ones we can actually sell
  const cached = await getCachedTldPricing();
  const pricingEntries = cached.entries;
  const enabledTlds = pricingEntries.filter((p: any) => p.enabled).map((p: any) => p.tld as string);

  if (enabledTlds.length === 0) {
    return c.json({ query: trimmed, results: [] });
  }

  const tlds = tldsParam
    ? tldsParam.split(',').map((t: string) => t.trim().toLowerCase()).filter((t: string) => enabledTlds.includes(t))
    : [];

  const dotIndex = trimmed.indexOf('.');
  let userTld: string | null = null;
  if (dotIndex > 0 && dotIndex < trimmed.length - 1) {
    userTld = trimmed.slice(dotIndex + 1);
    // Include user's TLD if it's one we support
    if (userTld && enabledTlds.includes(userTld) && !tlds.includes(userTld)) {
      tlds.unshift(userTld);
    }
    // Fill in popular TLDs as suggestions (limit to avoid slow API calls)
    if (!tldsParam) {
      for (const d of POPULAR_TLDS) {
        if (enabledTlds.includes(d) && !tlds.includes(d)) tlds.push(d);
      }
      // Fill remaining from enabled TLDs up to the cap
      for (const d of enabledTlds) {
        if (tlds.length >= MAX_SEARCH_TLDS) break;
        if (!tlds.includes(d)) tlds.push(d);
      }
    }
  } else if (!tldsParam) {
    // No TLD typed — search popular TLDs first, then fill up to cap
    for (const d of POPULAR_TLDS) {
      if (enabledTlds.includes(d)) tlds.push(d);
    }
    for (const d of enabledTlds) {
      if (tlds.length >= MAX_SEARCH_TLDS) break;
      if (!tlds.includes(d)) tlds.push(d);
    }
  }

  try {
    const results = await registrarService.searchDomains(trimmed, tlds);
    logger.debug({ query: trimmed, tldCount: tlds.length, resultCount: results.length }, 'Domain search raw results');

    // Overlay with our sell prices from domainTldPricing (cached)
    const pricingMap = new Map(pricingEntries.map((p: any) => [p.tld, p]));

    // Build TLD currency price map (cached)
    const tldCurrencyMap = new Map<string, Map<string, any>>();
    for (const cp of cached.currencyPrices) {
      if (!tldCurrencyMap.has(cp.tldPricingId)) tldCurrencyMap.set(cp.tldPricingId, new Map());
      tldCurrencyMap.get(cp.tldPricingId)!.set(cp.currency, cp);
    }

    const tc = targetCurrency?.toUpperCase() ?? null;

    const enriched = results
      .map((r: any) => {
        const tld = r.domain.split('.').slice(1).join('.');
        const pricing = pricingMap.get(tld);

        // Only show TLDs we have pricing for and that are enabled
        if (!pricing || !pricing.enabled) return null;

        // Check for fixed currency price
        const currencyPrices = tldCurrencyMap.get(pricing.id);
        const fixedPrice = tc ? currencyPrices?.get(tc) : null;

        if (fixedPrice) {
          return {
            ...r,
            price: {
              registration: fixedPrice.sellRegistrationPrice / 100,
              renewal: fixedPrice.sellRenewalPrice / 100,
              currency: tc,
            },
          };
        }

        return {
          ...r,
          price: {
            registration: pricing.sellRegistrationPrice / 100,
            renewal: pricing.sellRenewalPrice / 100,
            currency: pricing.currency,
          },
        };
      })
      .filter(Boolean);

    // Convert prices to requested currency if different (run in parallel)
    if (tc) {
      await Promise.all(enriched.map(async (r: any) => {
        if (r.price && r.price.currency && r.price.currency.toUpperCase() !== tc) {
          const origCurrency = r.price.currency;
          const [reg, ren] = await Promise.all([
            exchangeRateService.convert(r.price.registration, origCurrency, tc),
            exchangeRateService.convert(r.price.renewal, origCurrency, tc),
          ]);
          r.price.registration = reg;
          r.price.renewal = ren;
          r.price.currency = tc;
        }
      }));
    }

    // Sort: exact user-typed domain first, then available before taken
    if (userTld) {
      const exactDomain = trimmed.includes('.') ? trimmed : null;
      enriched.sort((a: any, b: any) => {
        if (exactDomain) {
          if (a.domain === exactDomain) return -1;
          if (b.domain === exactDomain) return 1;
        }
        // Then sort available domains before taken ones
        if (a.available && !b.available) return -1;
        if (!a.available && b.available) return 1;
        return 0;
      });
    }

    return c.json({ query: trimmed, results: enriched });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, message }, 'Domain search failed');
    return c.json(
      {
        error: 'Domain search failed',
        details: message,
      },
      500,
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// GET /public/search — public domain search (no auth required)
// ────────────────────────────────────────────────────────────────────────────
const publicSearchRoute = createRoute({
  method: 'get',
  path: '/public/search',
  tags: ['Domain Purchase'],
  summary: 'Search available domains (public, no auth)',
  request: {
    query: searchQuerySchema,
  },
  responses: {
    200: jsonContent(searchResultSchema, 'Domain search results'),
    ...standardErrors,
  },
  middleware: [publicSearchRateLimit],
});

domainPurchase.openapi(publicSearchRoute, handleDomainSearch as any);

// ────────────────────────────────────────────────────────────────────────────
// GET /search — search available domains (authenticated)
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

authed.openapi(searchRoute, handleDomainSearch as any);

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

authed.openapi(checkoutRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { domain, years, currency: requestedCurrency, successUrl, cancelUrl } = c.req.valid('json');

  // Validate max years against billing config
  const maxYears = await getDomainMaxYears();
  if (years > maxYears) {
    return c.json({ error: `Maximum registration period is ${maxYears} year${maxYears !== 1 ? 's' : ''}` }, 400);
  }

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

  let priceInCents = pricing.sellRegistrationPrice * years;
  let chargeCurrency = pricing.currency;

  // Convert to requested currency if different
  if (requestedCurrency && requestedCurrency.toUpperCase() !== pricing.currency.toUpperCase()) {
    chargeCurrency = requestedCurrency.toUpperCase();
    priceInCents = await exchangeRateService.convertCents(priceInCents, pricing.currency, chargeCurrency);
  }

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
      chargeCurrency,
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
// POST /bulk-checkout — create Stripe checkout session for multiple domains
// ────────────────────────────────────────────────────────────────────────────
const bulkCheckoutSchema = z.object({
  domains: z.array(z.object({
    domain: z.string().min(3).max(253).regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/),
    years: z.number().int().min(1).max(10).default(1),
  })).min(1).max(20),
  currency: z.string().length(3).optional().openapi({ description: 'Charge in this currency. Defaults to TLD pricing currency.' }),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
}).openapi('BulkDomainCheckoutRequest');

const bulkCheckoutRoute = createRoute({
  method: 'post',
  path: '/bulk-checkout',
  tags: ['Domain Purchase'],
  summary: 'Create Stripe checkout session for multiple domain registrations',
  security: bearerSecurity,
  request: {
    body: jsonBody(bulkCheckoutSchema),
  },
  responses: {
    200: jsonContent(checkoutResponseSchema, 'Checkout session URL'),
    ...standardErrors,
  },
});

authed.openapi(bulkCheckoutRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { domains, currency: requestedCurrency, successUrl, cancelUrl } = c.req.valid('json');

  if (!validateRedirectUrl(successUrl) || !validateRedirectUrl(cancelUrl)) {
    return c.json({ error: 'Invalid redirect URL: must match application origin' }, 400);
  }

  // Validate max years against billing config
  const maxYears = await getDomainMaxYears();
  for (const item of domains) {
    if (item.years > maxYears) {
      return c.json({ error: `Maximum registration period is ${maxYears} year${maxYears !== 1 ? 's' : ''}` }, 400);
    }
  }

  // Resolve pricing for each domain
  const lineItems: Array<{ domain: string; amountCents: number; currency: string; years: number }> = [];
  for (const item of domains) {
    const tld = item.domain.split('.').slice(1).join('.').toLowerCase();
    const pricing = await db.query.domainTldPricing.findFirst({
      where: eq(domainTldPricing.tld, tld),
    });

    if (!pricing || !pricing.enabled) {
      return c.json({ error: `Domain TLD .${tld} is not available for purchase` }, 400);
    }

    let priceInCents = pricing.sellRegistrationPrice * item.years;
    let chargeCurrency = pricing.currency;

    if (requestedCurrency && requestedCurrency.toUpperCase() !== pricing.currency.toUpperCase()) {
      chargeCurrency = requestedCurrency.toUpperCase();
      priceInCents = await exchangeRateService.convertCents(priceInCents, pricing.currency, chargeCurrency);
    }

    lineItems.push({ domain: item.domain, amountCents: priceInCents, currency: chargeCurrency, years: item.years });
  }

  // Ensure all line items use the same currency (Stripe requirement)
  const currencies = new Set(lineItems.map(li => li.currency.toUpperCase()));
  if (currencies.size > 1) {
    return c.json({ error: 'All domains must use the same currency for a single checkout' }, 400);
  }

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

    const session = await stripeService.createBulkDomainCheckoutSession(
      stripeCustomerId,
      lineItems,
      accountId,
      successUrl,
      cancelUrl,
    );

    return c.json({ url: session.url });
  } catch (err: any) {
    logger.error({ err, domains, accountId }, 'Bulk domain checkout failed');
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

authed.openapi(registerRoute, (async (c: any) => {
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

authed.openapi(renewCheckoutRoute, (async (c: any) => {
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

authed.openapi(renewRoute, (async (c: any) => {
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

authed.openapi(listRegistrationsRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const registrations = await registrarService.listRegistrations(accountId);
  return c.json(registrations);
}) as any);

domainPurchase.route('/', authed);

export default domainPurchase;
