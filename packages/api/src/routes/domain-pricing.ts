import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, domainTldPricing, domainTldCurrencyPrices, eq, deleteReturning } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { insertReturning, updateReturning } from '@fleet/db';
import { registrarService } from '../services/registrar.service.js';
import { logger } from '../services/logger.js';
import {
  jsonBody,
  jsonContent,
  errorResponseSchema,
  messageResponseSchema,
  standardErrors,
  bearerSecurity,
} from './_schemas.js';

const domainPricingRoutes = new OpenAPIHono<{
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

// ── Schemas ──

const domainPricingEntrySchema = z.object({
  id: z.string(),
  tld: z.string(),
  providerRegistrationPrice: z.number(),
  providerRenewalPrice: z.number(),
  markupType: z.string(),
  markupValue: z.number(),
  renewalMarkupType: z.string().nullable(),
  renewalMarkupValue: z.number().nullable(),
  sellRegistrationPrice: z.number(),
  sellRenewalPrice: z.number(),
  enabled: z.boolean().nullable(),
  currency: z.string(),
  createdAt: z.any().nullable(),
  updatedAt: z.any().nullable(),
}).openapi('DomainPricingEntry');

const upsertSchema = z.object({
  tld: z.string().min(1).max(63),
  providerRegistrationPrice: z.number().int().min(0),
  providerRenewalPrice: z.number().int().min(0),
  markupType: z.enum(['percentage', 'fixed_amount', 'fixed_price']).default('percentage'),
  markupValue: z.number().int().min(0).default(20),
  renewalMarkupType: z.enum(['percentage', 'fixed_amount', 'fixed_price']).nullable().optional(),
  renewalMarkupValue: z.number().int().min(0).nullable().optional(),
  enabled: z.boolean().default(true),
  currency: z.string().length(3).default('USD'),
}).openapi('DomainPricingUpsert');

const patchSchema = z.object({
  providerRegistrationPrice: z.number().int().min(0).optional(),
  providerRenewalPrice: z.number().int().min(0).optional(),
  markupType: z.enum(['percentage', 'fixed_amount', 'fixed_price']).optional(),
  markupValue: z.number().int().min(0).optional(),
  renewalMarkupType: z.enum(['percentage', 'fixed_amount', 'fixed_price']).nullable().optional(),
  renewalMarkupValue: z.number().int().min(0).nullable().optional(),
  enabled: z.boolean().optional(),
  currency: z.string().length(3).optional(),
}).openapi('DomainPricingPatch');

const idParamSchema = z.object({
  id: z.string().openapi({ description: 'Pricing entry ID' }),
});

// ── Routes ──

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Domain Pricing'],
  summary: 'List all TLD pricing entries',
  security: bearerSecurity,
  middleware: [],
  responses: {
    200: jsonContent(z.array(domainPricingEntrySchema), 'List of TLD pricing entries'),
    ...standardErrors,
  },
});

domainPricingRoutes.openapi(listRoute, (async (c: any) => {
  const entries = await db.query.domainTldPricing.findMany({
    orderBy: (p: any, { asc }: any) => asc(p.tld),
  });
  return c.json(entries, 200);
}) as any);

const upsertRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Domain Pricing'],
  summary: 'Create or update a TLD pricing entry',
  security: bearerSecurity,
  middleware: [],
  request: {
    body: jsonBody(upsertSchema),
  },
  responses: {
    200: jsonContent(domainPricingEntrySchema, 'Updated pricing entry'),
    201: jsonContent(domainPricingEntrySchema, 'Created pricing entry'),
    ...standardErrors,
  },
});

domainPricingRoutes.openapi(upsertRoute, (async (c: any) => {
  const data = c.req.valid('json');
  const tld = data.tld.replace(/^\./, '').toLowerCase();

  const sellRegistrationPrice = computeSellPrice(data.providerRegistrationPrice, data.markupType, data.markupValue);
  const renMarkupType = data.renewalMarkupType ?? data.markupType;
  const renMarkupValue = data.renewalMarkupValue ?? data.markupValue;
  const sellRenewalPrice = computeSellPrice(data.providerRenewalPrice, renMarkupType, renMarkupValue);

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
      renewalMarkupType: data.renewalMarkupType ?? null,
      renewalMarkupValue: data.renewalMarkupValue ?? null,
      sellRegistrationPrice,
      sellRenewalPrice,
      enabled: data.enabled,
      currency: data.currency,
      updatedAt: new Date(),
    }, eq(domainTldPricing.id, existing.id));
    return c.json(updated, 200);
  }

  const [entry] = await insertReturning(domainTldPricing, {
    tld,
    providerRegistrationPrice: data.providerRegistrationPrice,
    providerRenewalPrice: data.providerRenewalPrice,
    markupType: data.markupType,
    markupValue: data.markupValue,
    renewalMarkupType: data.renewalMarkupType ?? null,
    renewalMarkupValue: data.renewalMarkupValue ?? null,
    sellRegistrationPrice,
    sellRenewalPrice,
    enabled: data.enabled,
    currency: data.currency,
  });

  return c.json(entry, 201);
}) as any);

const patchRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Domain Pricing'],
  summary: 'Update a single TLD pricing entry',
  security: bearerSecurity,
  middleware: [],
  request: {
    params: idParamSchema,
    body: jsonBody(patchSchema),
  },
  responses: {
    200: jsonContent(domainPricingEntrySchema, 'Updated pricing entry'),
    ...standardErrors,
  },
});

domainPricingRoutes.openapi(patchRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const updates = c.req.valid('json');

  const existing = await db.query.domainTldPricing.findFirst({
    where: eq(domainTldPricing.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Pricing entry not found' }, 404);
  }

  const regPrice = updates.providerRegistrationPrice ?? existing.providerRegistrationPrice;
  const renPrice = updates.providerRenewalPrice ?? existing.providerRenewalPrice;
  const mType = updates.markupType ?? existing.markupType;
  const mValue = updates.markupValue ?? existing.markupValue;

  // For renewal: use dedicated renewal markup if provided, otherwise fall back to reg markup
  const renMarkupType = (updates.renewalMarkupType !== undefined ? updates.renewalMarkupType : existing.renewalMarkupType) ?? mType;
  const renMarkupValue = (updates.renewalMarkupValue !== undefined ? updates.renewalMarkupValue : existing.renewalMarkupValue) ?? mValue;

  const sellRegistrationPrice = computeSellPrice(regPrice, mType, mValue);
  const sellRenewalPrice = computeSellPrice(renPrice, renMarkupType, renMarkupValue);

  const [updated] = await updateReturning(domainTldPricing, {
    ...updates,
    sellRegistrationPrice,
    sellRenewalPrice,
    updatedAt: new Date(),
  }, eq(domainTldPricing.id, id));

  return c.json(updated, 200);
}) as any);

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Domain Pricing'],
  summary: 'Remove a TLD pricing entry',
  security: bearerSecurity,
  middleware: [],
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Pricing entry deleted'),
    ...standardErrors,
  },
});

domainPricingRoutes.openapi(deleteRoute, (async (c: any) => {
  const { id } = c.req.valid('param');

  const existing = await db.query.domainTldPricing.findFirst({
    where: eq(domainTldPricing.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Pricing entry not found' }, 404);
  }

  await db.delete(domainTldPricing).where(eq(domainTldPricing.id, id));

  return c.json({ message: 'Pricing entry deleted' }, 200);
}) as any);

const syncResponseSchema = z.object({
  message: z.string(),
}).openapi('DomainPricingSyncResponse');

const syncRoute = createRoute({
  method: 'post',
  path: '/sync',
  tags: ['Domain Pricing'],
  summary: 'Sync TLD prices from registrar provider',
  security: bearerSecurity,
  middleware: [],
  responses: {
    200: jsonContent(syncResponseSchema, 'Sync result'),
    ...standardErrors,
  },
});

domainPricingRoutes.openapi(syncRoute, (async (c: any) => {
  try {
    const provider = await registrarService.getProvider();
    const tldPrices = await provider.listTldPricing();
    let synced = 0;

    for (const { tld, registration, renewal, currency } of tldPrices) {
      const regPriceCents = Math.round(registration * 100);
      const renPriceCents = Math.round(renewal * 100);

      const existing = await db.query.domainTldPricing.findFirst({
        where: eq(domainTldPricing.tld, tld),
      });

      if (existing) {
        const sellReg = computeSellPrice(regPriceCents, existing.markupType, existing.markupValue);
        const renMarkupType = existing.renewalMarkupType ?? existing.markupType;
        const renMarkupValue = existing.renewalMarkupValue ?? existing.markupValue;
        const sellRen = computeSellPrice(renPriceCents, renMarkupType, renMarkupValue);

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
          currency,
        });
      }
      synced++;
    }

    return c.json({ message: `Synced ${synced} TLD prices from provider` }, 200);
  } catch (err) {
    logger.error({ err }, 'Price sync failed');
    return c.json({ error: 'Failed to sync prices' }, 500);
  }
}) as any);

// ─── TLD Currency Prices ─────────────────────────────────────────────────────

const tldCurrencyPriceSchema = z.object({
  currency: z.string().length(3),
  sellRegistrationPrice: z.number().int().min(0),
  sellRenewalPrice: z.number().int().min(0),
}).openapi('TldCurrencyPriceRequest');

const tldIdParamSchema = z.object({
  tldId: z.string().openapi({ description: 'TLD pricing entry ID' }),
});

const tldPriceIdParamSchema = z.object({
  tldId: z.string().openapi({ description: 'TLD pricing entry ID' }),
  priceId: z.string().openapi({ description: 'Currency price ID' }),
});

// GET /:tldId/prices — list currency prices for a TLD
const listTldPricesRoute = createRoute({
  method: 'get',
  path: '/{tldId}/prices',
  tags: ['Domain Pricing'],
  summary: 'List per-currency prices for a TLD',
  security: bearerSecurity,
  request: { params: tldIdParamSchema },
  responses: {
    200: jsonContent(z.array(z.any()), 'Currency prices'),
    ...standardErrors,
  },
});

domainPricingRoutes.openapi(listTldPricesRoute, (async (c: any) => {
  const { tldId } = c.req.valid('param');
  const prices = await db.query.domainTldCurrencyPrices.findMany({
    where: eq(domainTldCurrencyPrices.tldPricingId, tldId),
  });
  return c.json(prices);
}) as any);

// PUT /:tldId/prices — set all currency prices for a TLD (replaces existing)
const setTldPricesRoute = createRoute({
  method: 'put',
  path: '/{tldId}/prices',
  tags: ['Domain Pricing'],
  summary: 'Set per-currency prices for a TLD (replaces all)',
  security: bearerSecurity,
  request: {
    params: tldIdParamSchema,
    body: jsonBody(z.object({
      prices: z.array(tldCurrencyPriceSchema),
    })),
  },
  responses: {
    200: jsonContent(z.array(z.any()), 'Updated currency prices'),
    ...standardErrors,
  },
});

domainPricingRoutes.openapi(setTldPricesRoute, (async (c: any) => {
  const { tldId } = c.req.valid('param');
  const { prices } = c.req.valid('json');

  const tld = await db.query.domainTldPricing.findFirst({
    where: eq(domainTldPricing.id, tldId),
  });
  if (!tld) return c.json({ error: 'TLD pricing entry not found' }, 404);

  await db.delete(domainTldCurrencyPrices).where(eq(domainTldCurrencyPrices.tldPricingId, tldId));

  const result = [];
  for (const p of prices) {
    const [created] = await insertReturning(domainTldCurrencyPrices, {
      tldPricingId: tldId,
      currency: p.currency.toUpperCase(),
      sellRegistrationPrice: p.sellRegistrationPrice,
      sellRenewalPrice: p.sellRenewalPrice,
    });
    result.push(created);
  }

  return c.json(result);
}) as any);

// DELETE /:tldId/prices/:priceId — remove a single currency price
const deleteTldPriceRoute = createRoute({
  method: 'delete',
  path: '/{tldId}/prices/{priceId}',
  tags: ['Domain Pricing'],
  summary: 'Remove a per-currency TLD price',
  security: bearerSecurity,
  request: { params: tldPriceIdParamSchema },
  responses: {
    200: jsonContent(messageResponseSchema, 'Price removed'),
    ...standardErrors,
  },
});

domainPricingRoutes.openapi(deleteTldPriceRoute, (async (c: any) => {
  const { priceId } = c.req.valid('param');
  const [deleted] = await deleteReturning(domainTldCurrencyPrices, eq(domainTldCurrencyPrices.id, priceId));
  if (!deleted) return c.json({ error: 'Price not found' }, 404);
  return c.json({ message: 'Currency price removed' });
}) as any);

export default domainPricingRoutes;
