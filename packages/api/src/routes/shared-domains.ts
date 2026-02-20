import { Hono } from 'hono';
import { z } from 'zod';
import {
  db,
  sharedDomains,
  subdomainClaims,
  services,
  accounts,
  eq,
  and,
  isNull,
  insertReturning,
  updateReturning,
  deleteReturning,
  sql,
} from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { dockerService } from '../services/docker.service.js';
import { stripeService } from '../services/stripe.service.js';
import { invalidateCache } from '../middleware/cache.js';
import { logger } from '../services/logger.js';

const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Reserved subdomains that can't be claimed
const RESERVED_SUBDOMAINS = new Set([
  'www', 'mail', 'ftp', 'admin', 'api', 'ns1', 'ns2', 'ns3', 'ns4',
  'smtp', 'imap', 'pop', 'pop3', 'webmail', 'localhost', 'mx',
  'cpanel', 'whm', 'autoconfig', 'autodiscover', '_dmarc',
]);

// Subdomain format: lowercase alphanumeric + hyphens, 1-63 chars, can't start/end with hyphen
const subdomainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function buildTraefikLabels(
  serviceName: string,
  domain: string | null,
  sslEnabled: boolean,
): Record<string, string> {
  if (!domain) return { 'traefik.enable': 'false' };
  const routerName = serviceName.replace(/[^a-zA-Z0-9]/g, '-');
  const labels: Record<string, string> = {
    'traefik.enable': 'true',
    [`traefik.http.routers.${routerName}.rule`]: `Host(\`${domain}\`)`,
    [`traefik.http.routers.${routerName}.entrypoints`]: 'websecure',
    [`traefik.http.services.${routerName}.loadbalancer.server.port`]: '80',
  };
  if (sslEnabled) {
    labels[`traefik.http.routers.${routerName}.tls`] = 'true';
    labels[`traefik.http.routers.${routerName}.tls.certresolver`] = 'letsencrypt';
  }
  return labels;
}

// ─── Shared Domains Routes ────────────────────────────────────────────

const sharedDomainRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
    userRole: string;
  };
}>();

sharedDomainRoutes.use('*', authMiddleware);
sharedDomainRoutes.use('*', tenantMiddleware);

// ═══════════════════════════════════════════════════════════════════════
// Super admin endpoints
// ═══════════════════════════════════════════════════════════════════════

// GET /admin — List all shared domains with claim counts
sharedDomainRoutes.get('/admin', async (c) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super user access required' }, 403);

  const domains = await db.query.sharedDomains.findMany({
    with: { claims: { columns: { id: true } } },
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  return c.json(
    domains.map((d) => ({
      ...d,
      claimCount: d.claims.length,
      claims: undefined,
    })),
  );
});

// POST /admin — Add a shared domain
const createSchema = z.object({
  domain: z
    .string()
    .min(3)
    .max(255)
    .regex(/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i)
    .transform((v) => v.toLowerCase()),
  pricingType: z.enum(['free', 'one_time', 'monthly', 'quarterly', 'half_yearly', 'yearly']).default('free'),
  price: z.number().int().min(0).default(0),
  currency: z.string().length(3).default('USD'),
  maxPerAccount: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
});

sharedDomainRoutes.post('/admin', async (c) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super user access required' }, 403);

  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400);

  const { domain, pricingType, price, currency, maxPerAccount, enabled } = parsed.data;

  // Check for duplicate domain
  const existing = await db.query.sharedDomains.findFirst({
    where: eq(sharedDomains.domain, domain),
    columns: { id: true },
  });
  if (existing) return c.json({ error: 'Domain already exists' }, 409);

  const [created] = await insertReturning(sharedDomains, {
    domain,
    pricingType,
    price,
    currency,
    maxPerAccount,
    enabled,
    createdBy: user.userId,
  });

  return c.json(created, 201);
});

// PATCH /admin/:id — Update shared domain config
const updateSchema = z.object({
  enabled: z.boolean().optional(),
  pricingType: z.enum(['free', 'one_time', 'monthly', 'quarterly', 'half_yearly', 'yearly']).optional(),
  price: z.number().int().min(0).optional(),
  currency: z.string().length(3).optional(),
  maxPerAccount: z.number().int().min(0).optional(),
});

sharedDomainRoutes.patch('/admin/:id', async (c) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super user access required' }, 403);

  const id = c.req.param('id');
  if (!uuidRe.test(id)) return c.json({ error: 'Invalid ID' }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400);

  const [updated] = await updateReturning(
    sharedDomains,
    { ...parsed.data, updatedAt: new Date() },
    eq(sharedDomains.id, id),
  );

  if (!updated) return c.json({ error: 'Not found' }, 404);
  return c.json(updated);
});

// DELETE /admin/:id — Remove shared domain (cascades claims)
sharedDomainRoutes.delete('/admin/:id', async (c) => {
  const user = c.get('user');
  if (!user.isSuper) return c.json({ error: 'Super user access required' }, 403);

  const id = c.req.param('id');
  if (!uuidRe.test(id)) return c.json({ error: 'Invalid ID' }, 400);

  // Clear service domain references before cascade-deleting claims
  const claims = await db.query.subdomainClaims.findMany({
    where: eq(subdomainClaims.sharedDomainId, id),
    columns: { id: true, serviceId: true },
  });

  for (const claim of claims) {
    if (claim.serviceId) {
      await clearServiceDomain(claim.serviceId);
    }
  }

  const [deleted] = await deleteReturning(sharedDomains, eq(sharedDomains.id, id));
  if (!deleted) return c.json({ error: 'Not found' }, 404);
  return c.json({ success: true });
});

// ═══════════════════════════════════════════════════════════════════════
// User endpoints
// ═══════════════════════════════════════════════════════════════════════

// GET /available — List enabled shared domains
sharedDomainRoutes.get('/available', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account required' }, 400);

  const domains = await db.query.sharedDomains.findMany({
    where: eq(sharedDomains.enabled, true),
    orderBy: (t, { asc }) => [asc(t.domain)],
  });

  // Get claim counts per domain for this account
  const myClaims = await db.query.subdomainClaims.findMany({
    where: eq(subdomainClaims.accountId, accountId),
    columns: { sharedDomainId: true },
  });

  const claimsPerDomain = new Map<string, number>();
  for (const c of myClaims) {
    claimsPerDomain.set(c.sharedDomainId, (claimsPerDomain.get(c.sharedDomainId) ?? 0) + 1);
  }

  return c.json(
    domains.map((d) => ({
      id: d.id,
      domain: d.domain,
      pricingType: d.pricingType,
      price: d.price,
      currency: d.currency,
      maxPerAccount: d.maxPerAccount,
      myClaimCount: claimsPerDomain.get(d.id) ?? 0,
    })),
  );
});

// GET /mine — List user's claimed subdomains
sharedDomainRoutes.get('/mine', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account required' }, 400);

  const claims = await db.query.subdomainClaims.findMany({
    where: eq(subdomainClaims.accountId, accountId),
    with: {
      sharedDomain: { columns: { domain: true, pricingType: true, price: true, currency: true } },
      service: { columns: { id: true, name: true } },
    },
    orderBy: (t, { desc }) => [desc(t.createdAt)],
  });

  return c.json(
    claims.map((cl) => ({
      id: cl.id,
      subdomain: cl.subdomain,
      fullDomain: `${cl.subdomain}.${cl.sharedDomain.domain}`,
      sharedDomainId: cl.sharedDomainId,
      parentDomain: cl.sharedDomain.domain,
      pricingType: cl.sharedDomain.pricingType,
      price: cl.sharedDomain.price,
      currency: cl.sharedDomain.currency,
      serviceId: cl.serviceId,
      serviceName: cl.service?.name ?? null,
      status: cl.status,
      createdAt: cl.createdAt,
    })),
  );
});

// POST /claim — Claim a subdomain
const claimSchema = z.object({
  sharedDomainId: z.string().uuid(),
  subdomain: z
    .string()
    .min(1)
    .max(63)
    .transform((v) => v.toLowerCase()),
  serviceId: z.string().uuid().optional(),
});

sharedDomainRoutes.post('/claim', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account required' }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400);

  const { sharedDomainId, subdomain, serviceId } = parsed.data;

  // Validate subdomain format
  if (!subdomainRegex.test(subdomain)) {
    return c.json({ error: 'Invalid subdomain format. Use lowercase letters, numbers, and hyphens (1-63 chars).' }, 400);
  }

  // Check reserved
  if (RESERVED_SUBDOMAINS.has(subdomain)) {
    return c.json({ error: 'This subdomain is reserved' }, 400);
  }

  // Verify shared domain exists and is enabled
  const parentDomain = await db.query.sharedDomains.findFirst({
    where: and(eq(sharedDomains.id, sharedDomainId), eq(sharedDomains.enabled, true)),
  });
  if (!parentDomain) return c.json({ error: 'Shared domain not found or disabled' }, 404);

  // Check uniqueness (allow reclaiming stale pending-payment claims >30 min)
  const existingClaim = await db.query.subdomainClaims.findFirst({
    where: and(
      eq(subdomainClaims.sharedDomainId, sharedDomainId),
      eq(subdomainClaims.subdomain, subdomain),
    ),
    columns: { id: true, status: true, createdAt: true },
  });
  if (existingClaim) {
    const isStale = existingClaim.status === 'pending_payment' &&
      existingClaim.createdAt &&
      existingClaim.createdAt < new Date(Date.now() - 30 * 60 * 1000);
    if (isStale) {
      await deleteReturning(subdomainClaims, eq(subdomainClaims.id, existingClaim.id));
    } else {
      return c.json({ error: 'Subdomain already taken' }, 409);
    }
  }

  // Check account limit
  if (parentDomain.maxPerAccount > 0) {
    const accountClaimCount = await db
      .select({ count: sql<number>`count(*)` })
      .from(subdomainClaims)
      .where(and(
        eq(subdomainClaims.sharedDomainId, sharedDomainId),
        eq(subdomainClaims.accountId, accountId),
      ));
    if (Number(accountClaimCount[0]?.count ?? 0) >= parentDomain.maxPerAccount) {
      return c.json({ error: `Claim limit reached (max ${parentDomain.maxPerAccount} per account)` }, 400);
    }
  }

  // Verify service belongs to account if provided
  if (serviceId) {
    const svc = await db.query.services.findFirst({
      where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
      columns: { id: true },
    });
    if (!svc) return c.json({ error: 'Service not found' }, 404);
  }

  const fullDomain = `${subdomain}.${parentDomain.domain}`;

  // ── Free subdomain: create claim immediately ──
  if (parentDomain.pricingType === 'free' || !parentDomain.price || parentDomain.price === 0) {
    const [claim] = await insertReturning(subdomainClaims, {
      sharedDomainId,
      accountId,
      subdomain,
      serviceId: serviceId ?? null,
      status: 'active',
    });

    if (serviceId) {
      await assignDomainToService(serviceId, accountId, fullDomain);
    }

    return c.json({ ...claim, fullDomain }, 201);
  }

  // ── Paid subdomain: reserve with pending claim, redirect to Stripe checkout ──
  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
  });
  if (!account?.stripeCustomerId) {
    return c.json({ error: 'Please set up a payment method before claiming paid subdomains' }, 400);
  }

  const [pendingClaim] = await insertReturning(subdomainClaims, {
    sharedDomainId,
    accountId,
    subdomain,
    serviceId: serviceId ?? null,
    status: 'pending_payment',
  });

  const appUrl = process.env['APP_URL'] ?? 'http://localhost:5173';

  // Map recurring pricing types to Stripe intervals
  const RECURRING_INTERVALS: Record<string, { interval: 'month' | 'year'; interval_count?: number; label: string }> = {
    monthly: { interval: 'month', label: 'Monthly' },
    quarterly: { interval: 'month', interval_count: 3, label: 'Quarterly' },
    half_yearly: { interval: 'month', interval_count: 6, label: 'Semi-annual' },
    yearly: { interval: 'year', label: 'Yearly' },
  };
  const recurringConfig = RECURRING_INTERVALS[parentDomain.pricingType];
  const isRecurring = !!recurringConfig;

  try {
    const session = await stripeService.createFlexibleCheckoutSession(
      account.stripeCustomerId,
      [{
        price_data: {
          currency: (parentDomain.currency || 'USD').toLowerCase(),
          product_data: {
            name: `Subdomain: ${fullDomain}`,
            description: isRecurring
              ? `${recurringConfig.label} subdomain subscription`
              : 'One-time subdomain claim',
          },
          unit_amount: parentDomain.price,
          ...(isRecurring ? {
            recurring: {
              interval: recurringConfig.interval,
              ...(recurringConfig.interval_count ? { interval_count: recurringConfig.interval_count } : {}),
            },
          } : {}),
        },
        quantity: 1,
      }],
      {
        type: isRecurring ? 'subdomain_claim_recurring' : 'subdomain_claim_onetime',
        claimId: pendingClaim.id,
        accountId,
        subdomain,
        sharedDomainId,
        serviceId: serviceId ?? '',
        parentDomain: parentDomain.domain,
      },
      `${appUrl}/panel/domains?claim=success`,
      `${appUrl}/panel/domains?claim=cancelled`,
      isRecurring ? 'subscription' : 'payment',
    );

    return c.json({
      ...pendingClaim,
      fullDomain,
      checkoutUrl: session.url,
    }, 201);
  } catch (err) {
    // Checkout creation failed — clean up the pending claim
    await deleteReturning(subdomainClaims, eq(subdomainClaims.id, pendingClaim.id));
    logger.error({ err, subdomain: fullDomain }, 'Failed to create Stripe checkout for subdomain');
    return c.json({ error: 'Failed to create payment session' }, 500);
  }
});

// PATCH /:id — Update claim (change service assignment)
const updateClaimSchema = z.object({
  serviceId: z.string().uuid().nullable(),
});

sharedDomainRoutes.patch('/:id', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account required' }, 400);

  const id = c.req.param('id');
  if (!uuidRe.test(id)) return c.json({ error: 'Invalid ID' }, 400);

  const body = await c.req.json().catch(() => null);
  const parsed = updateClaimSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'Invalid input', details: parsed.error.flatten() }, 400);

  const { serviceId } = parsed.data;

  // Verify claim belongs to this account
  const claim = await db.query.subdomainClaims.findFirst({
    where: and(eq(subdomainClaims.id, id), eq(subdomainClaims.accountId, accountId)),
    with: { sharedDomain: { columns: { domain: true } } },
  });
  if (!claim) return c.json({ error: 'Claim not found' }, 404);

  // If clearing service, remove domain from old service
  if (claim.serviceId && claim.serviceId !== serviceId) {
    await clearServiceDomain(claim.serviceId);
  }

  // If assigning new service, verify it belongs to account
  if (serviceId) {
    const svc = await db.query.services.findFirst({
      where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
      columns: { id: true },
    });
    if (!svc) return c.json({ error: 'Service not found' }, 404);

    const fullDomain = `${claim.subdomain}.${claim.sharedDomain.domain}`;
    await assignDomainToService(serviceId, accountId, fullDomain);
  }

  const [updated] = await updateReturning(
    subdomainClaims,
    { serviceId: serviceId ?? null, updatedAt: new Date() },
    and(eq(subdomainClaims.id, id), eq(subdomainClaims.accountId, accountId))!,
  );

  return c.json(updated);
});

// DELETE /:id — Release a subdomain
sharedDomainRoutes.delete('/:id', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account required' }, 400);

  const id = c.req.param('id');
  if (!uuidRe.test(id)) return c.json({ error: 'Invalid ID' }, 400);

  const claim = await db.query.subdomainClaims.findFirst({
    where: and(eq(subdomainClaims.id, id), eq(subdomainClaims.accountId, accountId)),
    columns: { id: true, serviceId: true, stripeSubscriptionId: true },
  });
  if (!claim) return c.json({ error: 'Claim not found' }, 404);

  // Cancel Stripe subscription if this is a monthly paid claim
  if (claim.stripeSubscriptionId) {
    try {
      await stripeService.cancelSubscription(claim.stripeSubscriptionId);
    } catch (err) {
      logger.error({ err, claimId: id }, 'Failed to cancel Stripe subscription for subdomain claim');
    }
  }

  // Clear service domain if assigned
  if (claim.serviceId) {
    await clearServiceDomain(claim.serviceId);
  }

  await deleteReturning(subdomainClaims, and(eq(subdomainClaims.id, id), eq(subdomainClaims.accountId, accountId))!);
  return c.json({ success: true });
});

// ─── Helpers ──────────────────────────────────────────────────────────

async function assignDomainToService(serviceId: string, accountId: string, domain: string) {
  try {
    const svc = await db.query.services.findFirst({
      where: and(eq(services.id, serviceId), eq(services.accountId, accountId)),
    });
    if (!svc) return;

    // Update DB
    await updateReturning(
      services,
      { domain, sslEnabled: true, updatedAt: new Date() },
      eq(services.id, serviceId),
    );

    // Update Docker Traefik labels if service is deployed
    if (svc.dockerServiceId) {
      const labels = buildTraefikLabels(svc.name, domain, true);
      await dockerService.updateService(svc.dockerServiceId, {
        labels: {
          ...labels,
          'fleet.account-id': accountId,
          'fleet.service-id': serviceId,
        },
      });
    }

    await invalidateCache(`GET:/services:${accountId}`);
  } catch (err) {
    logger.error({ err, serviceId, domain }, 'Failed to assign domain to service');
  }
}

async function clearServiceDomain(serviceId: string) {
  try {
    const svc = await db.query.services.findFirst({
      where: eq(services.id, serviceId),
    });
    if (!svc) return;

    await updateReturning(
      services,
      { domain: null, updatedAt: new Date() },
      eq(services.id, serviceId),
    );

    if (svc.dockerServiceId) {
      const labels = buildTraefikLabels(svc.name, null, false);
      await dockerService.updateService(svc.dockerServiceId, {
        labels: {
          ...labels,
          'fleet.account-id': svc.accountId,
          'fleet.service-id': serviceId,
        },
      });
    }

    await invalidateCache(`GET:/services:${svc.accountId}`);
  } catch (err) {
    logger.error({ err, serviceId }, 'Failed to clear service domain');
  }
}

export default sharedDomainRoutes;
