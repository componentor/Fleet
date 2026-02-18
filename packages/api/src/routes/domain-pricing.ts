import { Hono } from 'hono';
import { z } from 'zod';
import { db, domainTldPricing, eq } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { insertReturning, updateReturning } from '@fleet/db';
import { registrarService } from '../services/registrar.service.js';
import { logger } from '../services/logger.js';

const domainPricingRoutes = new Hono<{
  Variables: {
    user: AuthUser;
  };
}>();

domainPricingRoutes.use('*', authMiddleware);

function requireSuper(c: any, next: any) {
  const user = c.get('user');
  if (!user?.isSuper) {
    return c.json({ error: 'Super admin access required' }, 403);
  }
  return next();
}

domainPricingRoutes.use('*', requireSuper);

function computeSellPrice(providerPrice: number, markupType: string, markupValue: number): number {
  switch (markupType) {
    case 'percentage':
      return Math.ceil(providerPrice * (1 + markupValue / 100));
    case 'fixed_amount':
      return providerPrice + markupValue;
    case 'fixed_price':
      return markupValue;
    default:
      return providerPrice;
  }
}

// GET / — list all TLD pricing entries
domainPricingRoutes.get('/', async (c) => {
  const entries = await db.query.domainTldPricing.findMany({
    orderBy: (p, { asc }) => asc(p.tld),
  });
  return c.json(entries);
});

// POST / — create or update a TLD pricing entry
const upsertSchema = z.object({
  tld: z.string().min(1).max(63),
  providerRegistrationPrice: z.number().int().min(0),
  providerRenewalPrice: z.number().int().min(0),
  markupType: z.enum(['percentage', 'fixed_amount', 'fixed_price']).default('percentage'),
  markupValue: z.number().int().min(0).default(20),
  enabled: z.boolean().default(true),
  currency: z.string().length(3).default('USD'),
});

domainPricingRoutes.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = upsertSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const data = parsed.data;
  const tld = data.tld.replace(/^\./, '').toLowerCase();

  const sellRegistrationPrice = computeSellPrice(data.providerRegistrationPrice, data.markupType, data.markupValue);
  const sellRenewalPrice = computeSellPrice(data.providerRenewalPrice, data.markupType, data.markupValue);

  // Check if exists
  const existing = await db.query.domainTldPricing.findFirst({
    where: eq(domainTldPricing.tld, tld),
  });

  if (existing) {
    const [updated] = await updateReturning(domainTldPricing, {
      providerRegistrationPrice: data.providerRegistrationPrice,
      providerRenewalPrice: data.providerRenewalPrice,
      markupType: data.markupType,
      markupValue: data.markupValue,
      sellRegistrationPrice,
      sellRenewalPrice,
      enabled: data.enabled,
      currency: data.currency,
      updatedAt: new Date(),
    }, eq(domainTldPricing.id, existing.id));
    return c.json(updated);
  }

  const [entry] = await insertReturning(domainTldPricing, {
    tld,
    providerRegistrationPrice: data.providerRegistrationPrice,
    providerRenewalPrice: data.providerRenewalPrice,
    markupType: data.markupType,
    markupValue: data.markupValue,
    sellRegistrationPrice,
    sellRenewalPrice,
    enabled: data.enabled,
    currency: data.currency,
  });

  return c.json(entry, 201);
});

// PATCH /:id — update a single TLD pricing entry
const patchSchema = z.object({
  providerRegistrationPrice: z.number().int().min(0).optional(),
  providerRenewalPrice: z.number().int().min(0).optional(),
  markupType: z.enum(['percentage', 'fixed_amount', 'fixed_price']).optional(),
  markupValue: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
  currency: z.string().length(3).optional(),
});

domainPricingRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = patchSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const existing = await db.query.domainTldPricing.findFirst({
    where: eq(domainTldPricing.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Pricing entry not found' }, 404);
  }

  const updates = parsed.data;
  const regPrice = updates.providerRegistrationPrice ?? existing.providerRegistrationPrice;
  const renPrice = updates.providerRenewalPrice ?? existing.providerRenewalPrice;
  const mType = updates.markupType ?? existing.markupType;
  const mValue = updates.markupValue ?? existing.markupValue;

  const sellRegistrationPrice = computeSellPrice(regPrice, mType, mValue);
  const sellRenewalPrice = computeSellPrice(renPrice, mType, mValue);

  const [updated] = await updateReturning(domainTldPricing, {
    ...updates,
    sellRegistrationPrice,
    sellRenewalPrice,
    updatedAt: new Date(),
  }, eq(domainTldPricing.id, id));

  return c.json(updated);
});

// DELETE /:id — remove a TLD pricing entry
domainPricingRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');

  const existing = await db.query.domainTldPricing.findFirst({
    where: eq(domainTldPricing.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Pricing entry not found' }, 404);
  }

  await db.delete(domainTldPricing).where(eq(domainTldPricing.id, id));

  return c.json({ message: 'Pricing entry deleted' });
});

// POST /sync — fetch prices from registrar and populate/update entries
domainPricingRoutes.post('/sync', async (c) => {
  try {
    const provider = await registrarService.getProvider();
    const commonTlds = ['com', 'net', 'org', 'io', 'dev', 'app', 'co', 'xyz', 'me', 'ai', 'no', 'se', 'dk', 'fi'];

    const results = await provider.searchDomains('test', commonTlds);
    let synced = 0;

    for (const result of results) {
      if (!result.price) continue;
      const tld = result.domain.split('.').slice(1).join('.');

      const existing = await db.query.domainTldPricing.findFirst({
        where: eq(domainTldPricing.tld, tld),
      });

      const regPriceCents = Math.round(result.price.registration * 100);
      const renPriceCents = Math.round(result.price.renewal * 100);

      if (existing) {
        const sellReg = computeSellPrice(regPriceCents, existing.markupType, existing.markupValue);
        const sellRen = computeSellPrice(renPriceCents, existing.markupType, existing.markupValue);

        await updateReturning(domainTldPricing, {
          providerRegistrationPrice: regPriceCents,
          providerRenewalPrice: renPriceCents,
          sellRegistrationPrice: sellReg,
          sellRenewalPrice: sellRen,
          updatedAt: new Date(),
        }, eq(domainTldPricing.id, existing.id));
      } else {
        const defaultMarkup = 20;
        const sellReg = computeSellPrice(regPriceCents, 'percentage', defaultMarkup);
        const sellRen = computeSellPrice(renPriceCents, 'percentage', defaultMarkup);

        await insertReturning(domainTldPricing, {
          tld,
          providerRegistrationPrice: regPriceCents,
          providerRenewalPrice: renPriceCents,
          markupType: 'percentage',
          markupValue: defaultMarkup,
          sellRegistrationPrice: sellReg,
          sellRenewalPrice: sellRen,
          enabled: true,
          currency: result.price.currency,
        });
      }
      synced++;
    }

    return c.json({ message: `Synced ${synced} TLD prices from provider` });
  } catch (err) {
    logger.error({ err }, 'Price sync failed');
    return c.json({ error: 'Failed to sync prices', details: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export default domainPricingRoutes;
