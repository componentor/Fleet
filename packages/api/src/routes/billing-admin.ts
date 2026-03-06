import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import {
  db,
  accounts,
  billingPlans,
  billingPlanPrices,
  pricingConfig,
  locationMultipliers,
  billingConfig,
  subscriptions,
  services,
  userAccounts,
  resourceLimits,
  accountBillingOverrides,
  insertReturning,
  updateReturning,
  deleteReturning,
  upsert,
  eq,
  and,
  isNull,
  isNotNull,
} from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { stripeSyncService } from '../services/stripe-sync.service.js';
import { orchestrator } from '../services/orchestrator.js';
import { notificationService } from '../services/notification.service.js';
import { eventService, EventTypes } from '../services/event.service.js';
import { emailService } from '../services/email.service.js';
import { getEmailQueue, isQueueAvailable } from '../services/queue.service.js';
import { logger, logToErrorTable } from '../services/logger.js';
import { currencyService } from '../services/currency.service.js';
import { getAppUrl } from '../services/platform.service.js';
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
  maxUsersPerAccount: z.number().int().min(0).optional(),
  priceCents: z.number().int().min(0),
  nameTranslations: z.record(z.string(), z.string()).optional(),
  descriptionTranslations: z.record(z.string(), z.string()).optional(),
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
  maxBackupStorageGb: z.number().int().min(0).nullable().optional(),
  backupClusterId: z.string().uuid().nullable().optional(),
  maxContainerDiskMb: z.number().int().min(0).nullable().optional(),
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
    with: { prices: true },
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
    logToErrorTable({ level: 'error', message: `Sync plan to Stripe failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing-admin', operation: 'sync-plan-to-stripe' } });
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
    logToErrorTable({ level: 'error', message: `Sync all plans to Stripe failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing-admin', operation: 'sync-all-plans-to-stripe' } });
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
    maxBackupStorageGb: null,
    backupClusterId: null,
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
      maxBackupStorageGb: override?.maxBackupStorageGb ?? global?.maxBackupStorageGb ?? null,
      backupClusterId: override?.backupClusterId ?? global?.backupClusterId ?? null,
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
    logToErrorTable({ level: 'error', message: `Failed to create metered prices: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing-admin', operation: 'create-metered-prices' } });
    return c.json({ error: 'Failed to create metered prices' }, 500);
  }
}) as any);

// ── Route definitions ── Account Suspension Management ──

const suspendAccountSchema = z.object({
  scheduleDeletionDays: z.number().int().min(0).optional(),
}).openapi('SuspendAccountRequest');

const unsuspendAccountRoute = createRoute({
  method: 'post',
  path: '/accounts/{accountId}/unsuspend',
  tags: ['Billing Admin'],
  summary: 'Manually unsuspend an account',
  security: bearerSecurity,
  request: {
    params: accountIdParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Account unsuspended'),
    ...standardErrors,
  },
});

const suspendAccountRoute = createRoute({
  method: 'post',
  path: '/accounts/{accountId}/suspend',
  tags: ['Billing Admin'],
  summary: 'Manually suspend an account',
  security: bearerSecurity,
  request: {
    params: accountIdParamSchema,
    body: jsonBody(suspendAccountSchema),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Account suspended'),
    ...standardErrors,
  },
});

const updateGracePeriodSchema = z.object({
  scheduledDeletionAt: z.string().datetime().nullable(),
}).openapi('UpdateGracePeriodRequest');

const updateGracePeriodRoute = createRoute({
  method: 'patch',
  path: '/accounts/{accountId}/grace-period',
  tags: ['Billing Admin'],
  summary: 'Update or cancel scheduled account deletion',
  security: bearerSecurity,
  request: {
    params: accountIdParamSchema,
    body: jsonBody(updateGracePeriodSchema),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Grace period updated'),
    ...standardErrors,
  },
});

// ── Handlers ── Account Suspension Management ──

async function queueAdminEmail(templateSlug: string, to: string, variables: Record<string, string>, accountId: string): Promise<void> {
  const data = { templateSlug, to, variables, accountId };
  if (isQueueAvailable()) {
    await getEmailQueue().add('send-email', data);
  } else {
    emailService.sendTemplateEmail(templateSlug, to, variables, accountId)
      .catch((err: unknown) => logger.error({ err }, `Failed to send ${templateSlug} email`));
  }
}

// POST /accounts/:accountId/suspend
billingAdmin.openapi(suspendAccountRoute, (async (c: any) => {
  const { accountId } = c.req.valid('param');
  const { scheduleDeletionDays } = c.req.valid('json');
  const user = c.get('user');

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
  });
  if (!account) return c.json({ error: 'Account not found' }, 404);
  if (account.status === 'suspended') return c.json({ error: 'Account is already suspended' }, 400);

  const now = new Date();
  const updateFields: Record<string, any> = {
    status: 'suspended',
    suspendedAt: now,
    updatedAt: now,
  };
  if (scheduleDeletionDays !== undefined && scheduleDeletionDays > 0) {
    updateFields.scheduledDeletionAt = new Date(now.getTime() + scheduleDeletionDays * 24 * 60 * 60 * 1000);
  }
  await db.update(accounts).set(updateFields).where(eq(accounts.id, accountId));

  // Suspend running services
  const accountServices = await db.query.services.findMany({
    where: and(eq(services.accountId, accountId), isNull(services.deletedAt), isNotNull(services.dockerServiceId)),
    columns: { id: true, dockerServiceId: true },
  });
  for (const svc of accountServices) {
    try {
      if (svc.dockerServiceId) {
        await orchestrator.scaleService(svc.dockerServiceId, 0);
        await db.update(services).set({ status: 'suspended', updatedAt: now }).where(eq(services.id, svc.id));
      }
    } catch (err) {
      logger.error({ err, serviceId: svc.id }, 'Failed to suspend service during admin suspension');
      logToErrorTable({ level: 'error', message: `Admin suspend service scale to 0 failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'billing-admin', operation: 'suspend-service-scale-to-zero' } });
    }
  }

  // Email owners + notification
  const appUrl = await getAppUrl();
  const ownerMembers = await db.query.userAccounts.findMany({
    where: and(eq(userAccounts.accountId, accountId), eq(userAccounts.role, 'owner')),
    with: { user: true },
  });
  for (const m of ownerMembers) {
    if (m.user?.email) {
      await queueAdminEmail('account-suspended', m.user.email, {
        accountName: account.name ?? 'Your account',
        deletionDays: scheduleDeletionDays ? String(scheduleDeletionDays) : 'N/A',
        billingUrl: `${appUrl}/panel/billing`,
      }, accountId);
    }
  }

  try {
    await notificationService.create(accountId, {
      type: 'billing',
      title: 'Account suspended',
      message: 'Your account has been suspended by an administrator.',
    });
  } catch { /* not critical */ }

  eventService.log({
    userId: user.userId,
    accountId,
    eventType: EventTypes.ACCOUNT_SUSPENDED,
    description: `Account manually suspended by admin`,
    resourceType: 'account',
    resourceId: accountId,
    resourceName: account.name ?? undefined,
    actorEmail: user.email,
    source: 'user',
  });

  return c.json({ message: 'Account suspended', servicesSuspended: accountServices.length });
}) as any);

// POST /accounts/:accountId/unsuspend
billingAdmin.openapi(unsuspendAccountRoute, (async (c: any) => {
  const { accountId } = c.req.valid('param');
  const user = c.get('user');

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
  });
  if (!account) return c.json({ error: 'Account not found' }, 404);
  if (account.status !== 'suspended') return c.json({ error: 'Account is not suspended' }, 400);

  await db.update(accounts).set({
    status: 'active',
    suspendedAt: null,
    scheduledDeletionAt: null,
    updatedAt: new Date(),
  }).where(eq(accounts.id, accountId));

  // Clear pastDueSince on subscriptions
  await db.update(subscriptions).set({
    pastDueSince: null,
    updatedAt: new Date(),
  }).where(eq(subscriptions.accountId, accountId));

  // Email owners + notification
  const appUrl = await getAppUrl();
  const ownerMembers = await db.query.userAccounts.findMany({
    where: and(eq(userAccounts.accountId, accountId), eq(userAccounts.role, 'owner')),
    with: { user: true },
  });
  for (const m of ownerMembers) {
    if (m.user?.email) {
      await queueAdminEmail('account-reactivated', m.user.email, {
        accountName: account.name ?? 'Your account',
        dashboardUrl: `${appUrl}/panel`,
      }, accountId);
    }
  }

  try {
    await notificationService.create(accountId, {
      type: 'billing',
      title: 'Account reactivated',
      message: 'Your account has been reactivated by an administrator. You can now restart your services.',
    });
  } catch { /* not critical */ }

  eventService.log({
    userId: user.userId,
    accountId,
    eventType: EventTypes.ACCOUNT_REACTIVATED,
    description: `Account manually unsuspended by admin`,
    resourceType: 'account',
    resourceId: accountId,
    resourceName: account.name ?? undefined,
    actorEmail: user.email,
    source: 'user',
  });

  return c.json({ message: 'Account unsuspended — services remain stopped until manually restarted' });
}) as any);

// PATCH /accounts/:accountId/grace-period
billingAdmin.openapi(updateGracePeriodRoute, (async (c: any) => {
  const { accountId } = c.req.valid('param');
  const { scheduledDeletionAt } = c.req.valid('json');
  const user = c.get('user');

  const account = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, accountId), isNull(accounts.deletedAt)),
  });
  if (!account) return c.json({ error: 'Account not found' }, 404);

  await db.update(accounts).set({
    scheduledDeletionAt: scheduledDeletionAt ? new Date(scheduledDeletionAt) : null,
    updatedAt: new Date(),
  }).where(eq(accounts.id, accountId));

  eventService.log({
    userId: user.userId,
    accountId,
    eventType: EventTypes.ACCOUNT_DELETION_SCHEDULED,
    description: scheduledDeletionAt
      ? `Scheduled deletion updated to ${scheduledDeletionAt}`
      : 'Scheduled deletion cancelled',
    resourceType: 'account',
    resourceId: accountId,
    resourceName: account.name ?? undefined,
    actorEmail: user.email,
    source: 'user',
  });

  return c.json({ message: scheduledDeletionAt ? `Deletion scheduled for ${scheduledDeletionAt}` : 'Scheduled deletion cancelled' });
}) as any);

// ─── Allowed Currencies ──────────────────────────────────────────────────────

const getAllowedCurrenciesRoute = createRoute({
  method: 'get',
  path: '/allowed-currencies',
  tags: ['Billing Admin'],
  summary: 'Get allowed currencies',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({ currencies: z.array(z.string()) }), 'Allowed currencies'),
    ...standardErrors,
  },
});

billingAdmin.openapi(getAllowedCurrenciesRoute, (async (c: any) => {
  const currencies = await currencyService.getAllowed();
  return c.json({ currencies });
}) as any);

const setAllowedCurrenciesRoute = createRoute({
  method: 'put',
  path: '/allowed-currencies',
  tags: ['Billing Admin'],
  summary: 'Set allowed currencies',
  security: bearerSecurity,
  request: {
    body: jsonBody(z.object({
      currencies: z.array(z.string().length(3)).min(1).openapi({ description: 'Array of 3-letter ISO currency codes' }),
    })),
  },
  responses: {
    200: jsonContent(z.object({ currencies: z.array(z.string()) }), 'Updated allowed currencies'),
    ...standardErrors,
  },
});

billingAdmin.openapi(setAllowedCurrenciesRoute, (async (c: any) => {
  const { currencies } = c.req.valid('json');
  const result = await currencyService.setAllowed(currencies);
  return c.json({ currencies: result });
}) as any);

// ─── Plan Currency Prices ────────────────────────────────────────────────────

const planPriceSchema = z.object({
  currency: z.string().length(3),
  priceCents: z.number().int().min(0),
}).openapi('PlanCurrencyPriceRequest');

const planIdParamSchema = z.object({
  planId: z.string().openapi({ description: 'Plan ID' }),
});

const planPriceIdParamSchema = z.object({
  planId: z.string().openapi({ description: 'Plan ID' }),
  priceId: z.string().openapi({ description: 'Price ID' }),
});

// GET /plans/:planId/prices — list currency prices for a plan
const listPlanPricesRoute = createRoute({
  method: 'get',
  path: '/plans/{planId}/prices',
  tags: ['Billing Admin'],
  summary: 'List per-currency prices for a plan',
  security: bearerSecurity,
  request: { params: planIdParamSchema },
  responses: {
    200: jsonContent(z.array(z.any()), 'Currency prices'),
    ...standardErrors,
  },
});

billingAdmin.openapi(listPlanPricesRoute, (async (c: any) => {
  const { planId } = c.req.valid('param');
  const prices = await db.query.billingPlanPrices.findMany({
    where: eq(billingPlanPrices.planId, planId),
  });
  return c.json(prices);
}) as any);

// PUT /plans/:planId/prices — set all currency prices for a plan (replaces existing)
const setPlanPricesRoute = createRoute({
  method: 'put',
  path: '/plans/{planId}/prices',
  tags: ['Billing Admin'],
  summary: 'Set per-currency prices for a plan (replaces all)',
  security: bearerSecurity,
  request: {
    params: planIdParamSchema,
    body: jsonBody(z.object({
      prices: z.array(planPriceSchema),
    })),
  },
  responses: {
    200: jsonContent(z.array(z.any()), 'Updated currency prices'),
    ...standardErrors,
  },
});

billingAdmin.openapi(setPlanPricesRoute, (async (c: any) => {
  const { planId } = c.req.valid('param');
  const { prices } = c.req.valid('json');

  // Verify plan exists
  const plan = await db.query.billingPlans.findFirst({
    where: eq(billingPlans.id, planId),
  });
  if (!plan) return c.json({ error: 'Plan not found' }, 404);

  // Delete existing prices
  await db.delete(billingPlanPrices).where(eq(billingPlanPrices.planId, planId));

  // Insert new prices
  const result = [];
  for (const p of prices) {
    const [created] = await insertReturning(billingPlanPrices, {
      planId,
      currency: p.currency.toUpperCase(),
      priceCents: p.priceCents,
    });
    result.push(created);
  }

  return c.json(result);
}) as any);

// DELETE /plans/:planId/prices/:priceId — remove a single currency price
const deletePlanPriceRoute = createRoute({
  method: 'delete',
  path: '/plans/{planId}/prices/{priceId}',
  tags: ['Billing Admin'],
  summary: 'Remove a per-currency price',
  security: bearerSecurity,
  request: { params: planPriceIdParamSchema },
  responses: {
    200: jsonContent(messageResponseSchema, 'Price removed'),
    ...standardErrors,
  },
});

billingAdmin.openapi(deletePlanPriceRoute, (async (c: any) => {
  const { priceId } = c.req.valid('param');
  const [deleted] = await deleteReturning(billingPlanPrices, eq(billingPlanPrices.id, priceId));
  if (!deleted) return c.json({ error: 'Price not found' }, 404);
  return c.json({ message: 'Currency price removed' });
}) as any);

export default billingAdmin;
