import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, domainTldPricing, eq } from '@fleet/db';
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
  enabled: z.boolean().default(true),
  currency: z.string().length(3).default('USD'),
}).openapi('DomainPricingUpsert');

const patchSchema = z.object({
  providerRegistrationPrice: z.number().int().min(0).optional(),
  providerRenewalPrice: z.number().int().min(0).optional(),
  markupType: z.enum(['percentage', 'fixed_amount', 'fixed_price']).optional(),
  markupValue: z.number().int().min(0).optional(),
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
    return c.json(updated, 200);
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

  const sellRegistrationPrice = computeSellPrice(regPrice, mType, mValue);
  const sellRenewalPrice = computeSellPrice(renPrice, mType, mValue);

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
    const commonTlds = ['com', 'net', 'org', 'io', 'dev', 'app', 'co', 'xyz', 'me', 'ai', 'no', 'se', 'dk', 'fi'];

    // Use a random string to avoid hitting premium domain pricing
    const randomQuery = `fleetpricecheck${Date.now().toString(36)}`;
    const results = await provider.searchDomains(randomQuery, commonTlds);
    let synced = 0;
    let skippedPremium = 0;

    for (const result of results) {
      if (!result.price) continue;
      // Skip premium domains — their pricing is not representative of standard TLD rates
      if (result.premium) {
        skippedPremium++;
        continue;
      }
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

    const msg = skippedPremium > 0
      ? `Synced ${synced} TLD prices from provider (skipped ${skippedPremium} premium TLDs)`
      : `Synced ${synced} TLD prices from provider`;
    return c.json({ message: msg }, 200);
  } catch (err) {
    logger.error({ err }, 'Price sync failed');
    return c.json({ error: 'Failed to sync prices' }, 500);
  }
}) as any);

export default domainPricingRoutes;
