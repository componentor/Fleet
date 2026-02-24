import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import {
  db,
  billingPlans,
  pricingConfig,
  locationMultipliers,
  billingConfig,
  subscriptions,
  resourceLimits,
  accountBillingOverrides,
  insertReturning,
  updateReturning,
  deleteReturning,
  upsert,
  eq,
  and,
  isNull,
} from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { stripeSyncService } from '../services/stripe-sync.service.js';
import { logger } from '../services/logger.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

type AdminEnv = {
  Variables: {
    user: AuthUser;
  };
};

const billingAdmin = new OpenAPIHono<AdminEnv>();
billingAdmin.use('*', authMiddleware);

// Require super admin for all routes
billingAdmin.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super admin access required' }, 403);
  }
  await next();
});

// ── Schemas ──

const createPlanSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
  sortOrder: z.number().int().default(0),
  isDefault: z.boolean().default(false),
  isFree: z.boolean().default(false),
  visible: z.boolean().default(true),
  cpuLimit: z.number().int().min(0),
  memoryLimit: z.number().int().min(0),
  containerLimit: z.number().int().min(0),
  storageLimit: z.number().int().min(0),
  bandwidthLimit: z.number().int().min(0).optional(),
  priceCents: z.number().int().min(0),
}).openapi('CreatePlanRequest');

const pricingSchema = z.object({
  cpuCentsPerHour: z.number().int().min(0).optional(),
  memoryCentsPerGbHour: z.number().int().min(0).optional(),
  storageCentsPerGbMonth: z.number().int().min(0).optional(),
  bandwidthCentsPerGb: z.number().int().min(0).optional(),
  containerCentsPerHour: z.number().int().min(0).optional(),
  domainMarkupPercent: z.number().int().min(0).max(100).optional(),
  backupStorageCentsPerGb: z.number().int().min(0).optional(),
  locationPricingEnabled: z.boolean().optional(),
}).openapi('PricingConfigRequest');

const locationSchema = z.object({
  locationKey: z.string().min(1),
  label: z.string().min(1),
  multiplier: z.number().int().min(1).default(100),
}).openapi('LocationRequest');

const resourceLimitsSchema = z.object({
  maxCpuPerContainer: z.number().int().min(0).nullable().optional(),
  maxMemoryPerContainer: z.number().int().min(0).nullable().optional(),
  maxReplicas: z.number().int().min(0).nullable().optional(),
  maxContainers: z.number().int().min(0).nullable().optional(),
  maxStorageGb: z.number().int().min(0).nullable().optional(),
  maxBandwidthGb: z.number().int().min(0).nullable().optional(),
  maxNfsStorageGb: z.number().int().min(0).nullable().optional(),
  maxTotalCpuCores: z.number().int().min(0).nullable().optional(),
  maxTotalMemoryMb: z.number().int().min(0).nullable().optional(),
}).openapi('ResourceLimitsRequest');

const overrideSchema = z.object({
  discountPercent: z.number().int().min(0).max(100).optional(),
  customPriceCents: z.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
  cpuCentsPerHourOverride: z.number().int().min(0).nullable().optional(),
  memoryCentsPerGbHourOverride: z.number().int().min(0).nullable().optional(),
  storageCentsPerGbMonthOverride: z.number().int().min(0).nullable().optional(),
  bandwidthCentsPerGbOverride: z.number().int().min(0).nullable().optional(),
  containerCentsPerHourOverride: z.number().int().min(0).nullable().optional(),
}).openapi('AccountBillingOverrideRequest');

const idParamSchema = z.object({
  id: z.string().openapi({ description: 'Resource ID' }),
});

const accountIdParamSchema = z.object({
  accountId: z.string().openapi({ description: 'Account ID' }),
});

// ── Route definitions ── Plan Management ──

const listPlansRoute = createRoute({
  method: 'get',
  path: '/plans',
  tags: ['Billing Admin'],
  summary: 'List all plans (including hidden)',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.any()), 'List of all billing plans'),
    ...standardErrors,
  },
});

const createPlanRoute = createRoute({
  method: 'post',
  path: '/plans',
  tags: ['Billing Admin'],
  summary: 'Create a new billing plan',
  security: bearerSecurity,
  request: {
    body: jsonBody(createPlanSchema),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'Created plan'),
  },
});

const updatePlanRoute = createRoute({
  method: 'patch',
  path: '/plans/{id}',
  tags: ['Billing Admin'],
  summary: 'Update a billing plan',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonBody(createPlanSchema.partial()),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated plan'),
    ...standardErrors,
  },
});

const deletePlanRoute = createRoute({
  method: 'delete',
  path: '/plans/{id}',
  tags: ['Billing Admin'],
  summary: 'Soft-delete a plan (set visible: false)',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Plan hidden'),
    ...standardErrors,
  },
});

const syncPlanRoute = createRoute({
  method: 'post',
  path: '/plans/{id}/sync-stripe',
  tags: ['Billing Admin'],
  summary: 'Sync a single plan to Stripe',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Plan synced to Stripe'),
    ...standardErrors,
  },
});

const syncAllPlansRoute = createRoute({
  method: 'post',
  path: '/plans/sync-all',
  tags: ['Billing Admin'],
  summary: 'Sync all plans to Stripe',
  security: bearerSecurity,
  responses: {
    200: jsonContent(messageResponseSchema, 'All plans synced'),
    ...standardErrors,
  },
});

// ── Route definitions ── Usage Pricing ──

const getPricingRoute = createRoute({
  method: 'get',
  path: '/pricing',
  tags: ['Billing Admin'],
  summary: 'Get usage pricing config',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Pricing configuration'),
    ...standardErrors,
  },
});

const updatePricingRoute = createRoute({
  method: 'patch',
  path: '/pricing',
  tags: ['Billing Admin'],
  summary: 'Update usage pricing rates',
  security: bearerSecurity,
  request: {
    body: jsonBody(pricingSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Updated pricing config'),
    201: jsonContent(z.any(), 'Created pricing config'),
  },
});

// ── Route definitions ── Location Multipliers ──

const listLocationsRoute = createRoute({
  method: 'get',
  path: '/locations',
  tags: ['Billing Admin'],
  summary: 'List location multipliers',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.any()), 'Location multipliers'),
    ...standardErrors,
  },
});

const createLocationRoute = createRoute({
  method: 'post',
  path: '/locations',
  tags: ['Billing Admin'],
  summary: 'Add a location multiplier',
  security: bearerSecurity,
  request: {
    body: jsonBody(locationSchema),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'Created location'),
  },
});

const updateLocationRoute = createRoute({
  method: 'patch',
  path: '/locations/{id}',
  tags: ['Billing Admin'],
  summary: 'Update a location multiplier',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonBody(locationSchema.partial()),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated location'),
    ...standardErrors,
  },
});

const deleteLocationRoute = createRoute({
  method: 'delete',
  path: '/locations/{id}',
  tags: ['Billing Admin'],
  summary: 'Remove a location multiplier',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Location removed'),
    ...standardErrors,
  },
});

// ── Route definitions ── Resource Limits ──

const getGlobalResourceLimitsRoute = createRoute({
  method: 'get',
  path: '/resource-limits',
  tags: ['Billing Admin'],
  summary: 'Get global resource limit defaults',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Global resource limits'),
    ...standardErrors,
  },
});

const updateGlobalResourceLimitsRoute = createRoute({
  method: 'patch',
  path: '/resource-limits',
  tags: ['Billing Admin'],
  summary: 'Update global resource limit defaults',
  security: bearerSecurity,
  request: {
    body: jsonBody(resourceLimitsSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Updated resource limits'),
    201: jsonContent(z.any(), 'Created resource limits'),
  },
});

const getAccountResourceLimitsRoute = createRoute({
  method: 'get',
  path: '/resource-limits/{accountId}',
  tags: ['Billing Admin'],
  summary: 'Get per-account resource limit override',
  security: bearerSecurity,
  request: {
    params: accountIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Account resource limits with effective values'),
    ...standardErrors,
  },
});

const updateAccountResourceLimitsRoute = createRoute({
  method: 'patch',
  path: '/resource-limits/{accountId}',
  tags: ['Billing Admin'],
  summary: 'Set per-account resource limit override',
  security: bearerSecurity,
  request: {
    params: accountIdParamSchema,
    body: jsonBody(resourceLimitsSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Updated account resource limits'),
    201: jsonContent(z.any(), 'Created account resource limits'),
  },
});

const deleteAccountResourceLimitsRoute = createRoute({
  method: 'delete',
  path: '/resource-limits/{accountId}',
  tags: ['Billing Admin'],
  summary: 'Remove per-account resource limit override',
  security: bearerSecurity,
  request: {
    params: accountIdParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Override removed'),
    ...standardErrors,
  },
});

// ── Route definitions ── Account Billing Overrides ──

const listOverridesRoute = createRoute({
  method: 'get',
  path: '/account-overrides',
  tags: ['Billing Admin'],
  summary: 'List all account billing overrides',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.any()), 'Account billing overrides'),
    ...standardErrors,
  },
});

const getOverrideRoute = createRoute({
  method: 'get',
  path: '/account-overrides/{accountId}',
  tags: ['Billing Admin'],
  summary: 'Get billing override for a specific account',
  security: bearerSecurity,
  request: {
    params: accountIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Account billing override'),
    ...standardErrors,
  },
});

const upsertOverrideRoute = createRoute({
  method: 'patch',
  path: '/account-overrides/{accountId}',
  tags: ['Billing Admin'],
  summary: 'Create or update account billing override',
  security: bearerSecurity,
  request: {
    params: accountIdParamSchema,
    body: jsonBody(overrideSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Updated override'),
    201: jsonContent(z.any(), 'Created override'),
  },
});

const deleteOverrideRoute = createRoute({
  method: 'delete',
  path: '/account-overrides/{accountId}',
  tags: ['Billing Admin'],
  summary: 'Remove account billing override',
  security: bearerSecurity,
  request: {
    params: accountIdParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Override removed'),
    ...standardErrors,
  },
});

// ── Route definitions ── Subscriptions ──

const listSubscriptionsRoute = createRoute({
  method: 'get',
  path: '/subscriptions',
  tags: ['Billing Admin'],
  summary: 'List all subscriptions',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.any()), 'All subscriptions'),
    ...standardErrors,
  },
});

// ── Route definitions ── Metered Prices ──

const createMeteredPricesRoute = createRoute({
  method: 'post',
  path: '/metered-prices',
  tags: ['Billing Admin'],
  summary: 'Create or update metered Stripe prices',
  security: bearerSecurity,
  responses: {
    200: jsonContent(messageResponseSchema, 'Metered prices created'),
    ...standardErrors,
  },
});

// ── Handlers ── Plan Management ──

// GET /plans — list all plans (including hidden)
billingAdmin.openapi(listPlansRoute, (async (c: any) => {
  const plans = await db.query.billingPlans.findMany({
    orderBy: (p: any, { asc }: any) => asc(p.sortOrder),
  });
  return c.json(plans);
}) as any);

// POST /plans — create a new plan
billingAdmin.openapi(createPlanRoute, (async (c: any) => {
  const data = c.req.valid('json');
  const [plan] = await insertReturning(billingPlans, data);
  return c.json(plan, 201);
}) as any);

// PATCH /plans/:id — update a plan
billingAdmin.openapi(updatePlanRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const data = c.req.valid('json');

  const [updated] = await updateReturning(billingPlans, {
    ...data,
    updatedAt: new Date(),
  }, eq(billingPlans.id, id));

  if (!updated) {
    return c.json({ error: 'Plan not found' }, 404);
  }

  return c.json(updated);
}) as any);

// DELETE /plans/:id — soft-delete (set visible: false)
billingAdmin.openapi(deletePlanRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const [updated] = await updateReturning(billingPlans, {
    visible: false,
    updatedAt: new Date(),
  }, eq(billingPlans.id, id));

  if (!updated) {
    return c.json({ error: 'Plan not found' }, 404);
  }

  return c.json({ message: 'Plan hidden', plan: updated });
}) as any);

// POST /plans/:id/sync-stripe — sync a single plan to Stripe
billingAdmin.openapi(syncPlanRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  try {
    await stripeSyncService.syncPlanToStripe(id);
    return c.json({ message: 'Plan synced to Stripe' });
  } catch (err) {
    logger.error({ err, planId: id }, 'Failed to sync plan to Stripe');
    return c.json({ error: 'Failed to sync plan to Stripe' }, 500);
  }
}) as any);

// POST /plans/sync-all — sync all plans to Stripe
billingAdmin.openapi(syncAllPlansRoute, (async (c: any) => {
  try {
    const result = await stripeSyncService.syncAllPlans();
    return c.json({ message: `${result.synced} plan(s) synced to Stripe` });
  } catch (err) {
    logger.error({ err }, 'Failed to sync all plans to Stripe');
    return c.json({ error: 'Sync failed' }, 500);
  }
}) as any);

// ── Handlers ── Usage Pricing ──

// GET /pricing — get usage pricing config
billingAdmin.openapi(getPricingRoute, (async (c: any) => {
  const pricing = await db.query.pricingConfig.findFirst();
  return c.json(pricing ?? {
    cpuCentsPerHour: 0,
    memoryCentsPerGbHour: 0,
    storageCentsPerGbMonth: 0,
    bandwidthCentsPerGb: 0,
    containerCentsPerHour: 0,
    domainMarkupPercent: 0,
    backupStorageCentsPerGb: 0,
    locationPricingEnabled: false,
  });
}) as any);

// PATCH /pricing — update usage rates
billingAdmin.openapi(updatePricingRoute, (async (c: any) => {
  const data = c.req.valid('json');

  const existing = await db.query.pricingConfig.findFirst();
  if (existing) {
    const [updated] = await updateReturning(pricingConfig, {
      ...data,
      updatedAt: new Date(),
    }, eq(pricingConfig.id, existing.id));
    return c.json(updated);
  }

  const [created] = await insertReturning(pricingConfig, data);
  return c.json(created, 201);
}) as any);

// ── Handlers ── Location Multipliers ──

// GET /locations — list location multipliers
billingAdmin.openapi(listLocationsRoute, (async (c: any) => {
  const locations = await db.query.locationMultipliers.findMany();
  return c.json(locations);
}) as any);

// POST /locations — add a location
billingAdmin.openapi(createLocationRoute, (async (c: any) => {
  const data = c.req.valid('json');
  const [location] = await insertReturning(locationMultipliers, data);
  return c.json(location, 201);
}) as any);

// PATCH /locations/:id — update multiplier
billingAdmin.openapi(updateLocationRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const data = c.req.valid('json');

  const [updated] = await updateReturning(locationMultipliers, data, eq(locationMultipliers.id, id));
  if (!updated) {
    return c.json({ error: 'Location not found' }, 404);
  }
  return c.json(updated);
}) as any);

// DELETE /locations/:id — remove a location
billingAdmin.openapi(deleteLocationRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const [deleted] = await deleteReturning(locationMultipliers, eq(locationMultipliers.id, id));
  if (!deleted) {
    return c.json({ error: 'Location not found' }, 404);
  }
  return c.json({ message: 'Location removed' });
}) as any);

// ── Handlers ── Resource Limits ──

// GET /resource-limits — get global defaults
billingAdmin.openapi(getGlobalResourceLimitsRoute, (async (c: any) => {
  const global = await db.query.resourceLimits.findFirst({
    where: isNull(resourceLimits.accountId),
  });
  return c.json(global ?? {
    maxCpuPerContainer: null,
    maxMemoryPerContainer: null,
    maxReplicas: null,
    maxContainers: null,
    maxStorageGb: null,
    maxBandwidthGb: null,
    maxNfsStorageGb: null,
    maxTotalCpuCores: null,
    maxTotalMemoryMb: null,
  });
}) as any);

// PATCH /resource-limits — update global defaults
billingAdmin.openapi(updateGlobalResourceLimitsRoute, (async (c: any) => {
  const data = c.req.valid('json');

  const existing = await db.query.resourceLimits.findFirst({
    where: isNull(resourceLimits.accountId),
  });

  if (existing) {
    const [updated] = await updateReturning(resourceLimits, {
      ...data,
      updatedAt: new Date(),
    }, eq(resourceLimits.id, existing.id));
    return c.json(updated);
  }

  const [created] = await insertReturning(resourceLimits, {
    accountId: null,
    ...data,
  });
  return c.json(created, 201);
}) as any);

// GET /resource-limits/:accountId — get per-account override
billingAdmin.openapi(getAccountResourceLimitsRoute, (async (c: any) => {
  const { accountId } = c.req.valid('param');
  const override = await db.query.resourceLimits.findFirst({
    where: eq(resourceLimits.accountId, accountId),
  });
  const global = await db.query.resourceLimits.findFirst({
    where: isNull(resourceLimits.accountId),
  });

  return c.json({
    global: global ?? null,
    override: override ?? null,
    effective: {
      maxCpuPerContainer: override?.maxCpuPerContainer ?? global?.maxCpuPerContainer ?? null,
      maxMemoryPerContainer: override?.maxMemoryPerContainer ?? global?.maxMemoryPerContainer ?? null,
      maxReplicas: override?.maxReplicas ?? global?.maxReplicas ?? null,
      maxContainers: override?.maxContainers ?? global?.maxContainers ?? null,
      maxStorageGb: override?.maxStorageGb ?? global?.maxStorageGb ?? null,
      maxBandwidthGb: override?.maxBandwidthGb ?? global?.maxBandwidthGb ?? null,
      maxNfsStorageGb: override?.maxNfsStorageGb ?? global?.maxNfsStorageGb ?? null,
      maxTotalCpuCores: override?.maxTotalCpuCores ?? global?.maxTotalCpuCores ?? null,
      maxTotalMemoryMb: override?.maxTotalMemoryMb ?? global?.maxTotalMemoryMb ?? null,
    },
  });
}) as any);

// PATCH /resource-limits/:accountId — set per-account override
billingAdmin.openapi(updateAccountResourceLimitsRoute, (async (c: any) => {
  const { accountId } = c.req.valid('param');
  const data = c.req.valid('json');

  const existing = await db.query.resourceLimits.findFirst({
    where: eq(resourceLimits.accountId, accountId),
  });

  if (existing) {
    const [updated] = await updateReturning(resourceLimits, {
      ...data,
      updatedAt: new Date(),
    }, eq(resourceLimits.id, existing.id));
    return c.json(updated);
  }

  const [created] = await insertReturning(resourceLimits, {
    accountId,
    ...data,
  });
  return c.json(created, 201);
}) as any);

// DELETE /resource-limits/:accountId — remove per-account override (falls back to global)
billingAdmin.openapi(deleteAccountResourceLimitsRoute, (async (c: any) => {
  const { accountId } = c.req.valid('param');
  const [deleted] = await deleteReturning(resourceLimits, eq(resourceLimits.accountId, accountId));
  if (!deleted) {
    return c.json({ error: 'Override not found' }, 404);
  }
  return c.json({ message: 'Account override removed, global limits apply' });
}) as any);

// ── Handlers ── Account Billing Overrides ──

// GET /account-overrides — list all overrides
billingAdmin.openapi(listOverridesRoute, (async (c: any) => {
  const overrides = await db.query.accountBillingOverrides.findMany({
    with: { account: true },
  });
  return c.json(overrides);
}) as any);

// GET /account-overrides/:accountId — get override for a specific account
billingAdmin.openapi(getOverrideRoute, (async (c: any) => {
  const { accountId } = c.req.valid('param');
  const override = await db.query.accountBillingOverrides.findFirst({
    where: eq(accountBillingOverrides.accountId, accountId),
  });
  return c.json(override ?? null);
}) as any);

// PATCH /account-overrides/:accountId — create or update account override
billingAdmin.openapi(upsertOverrideRoute, (async (c: any) => {
  const { accountId } = c.req.valid('param');
  const data = c.req.valid('json');

  const existing = await db.query.accountBillingOverrides.findFirst({
    where: eq(accountBillingOverrides.accountId, accountId),
  });

  if (existing) {
    const [updated] = await updateReturning(accountBillingOverrides, {
      ...data,
      updatedAt: new Date(),
    }, eq(accountBillingOverrides.id, existing.id));
    return c.json(updated);
  }

  const [created] = await insertReturning(accountBillingOverrides, {
    accountId,
    ...data,
  });
  return c.json(created, 201);
}) as any);

// DELETE /account-overrides/:accountId — remove account override
billingAdmin.openapi(deleteOverrideRoute, (async (c: any) => {
  const { accountId } = c.req.valid('param');
  const [deleted] = await deleteReturning(accountBillingOverrides, eq(accountBillingOverrides.accountId, accountId));
  if (!deleted) {
    return c.json({ error: 'Override not found' }, 404);
  }
  return c.json({ message: 'Account billing override removed' });
}) as any);

// ── Handlers ── Subscriptions ──

// GET /subscriptions — list all subscriptions (paginated)
billingAdmin.openapi(listSubscriptionsRoute, (async (c: any) => {
  const subs = await db.query.subscriptions.findMany({
    with: { account: true, plan: true },
    orderBy: (s: any, { desc: d }: any) => d(s.createdAt),
  });
  return c.json(subs);
}) as any);

// ── Handlers ── Metered Prices ──

// POST /metered-prices — create/update metered Stripe prices
billingAdmin.openapi(createMeteredPricesRoute, (async (c: any) => {
  try {
    await stripeSyncService.ensureMeteredPrices();
    return c.json({ message: 'Metered prices created in Stripe' });
  } catch (err) {
    logger.error({ err }, 'Failed to create metered prices');
    return c.json({ error: 'Failed to create metered prices' }, 500);
  }
}) as any);

export default billingAdmin;
