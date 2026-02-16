import { Hono } from 'hono';
import { z } from 'zod';
import { db, domainRegistrations, eq, and } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { registrarService } from '../services/registrar.service.js';

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
// GET /search — search available domains
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
    return c.json({ query: query.trim(), results });
  } catch (err) {
    console.error('Domain search failed:', err);
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
// POST /register — purchase / register a domain
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
    country: z.string().length(2), // ISO 3166-1 alpha-2
    organization: z.string().optional(),
  }),
});

domainPurchase.post('/register', async (c) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = registerDomainSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
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
    console.error('Domain registration failed:', err);
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
// POST /:id/renew — renew a domain registration
// ────────────────────────────────────────────────────────────────────────────
const renewSchema = z.object({
  years: z.number().int().min(1).max(10).default(1),
});

domainPurchase.post('/:id/renew', async (c) => {
  const accountId = c.get('accountId');
  const registrationId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Verify ownership
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
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  try {
    const updated = await registrarService.renewDomain(
      registrationId,
      parsed.data.years,
    );

    return c.json(updated);
  } catch (err) {
    console.error('Domain renewal failed:', err);
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
