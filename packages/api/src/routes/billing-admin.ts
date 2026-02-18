import { Hono } from 'hono';
import { z } from 'zod';
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

type AdminEnv = {
  Variables: {
    user: AuthUser;
  };
};

const billingAdmin = new Hono<AdminEnv>();
billingAdmin.use('*', authMiddleware);

// Require super admin for all routes
billingAdmin.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super admin access required' }, 403);
  }
  await next();
});

// ─── Plan Management ─────────────────────────────────────────────────────────

// GET /plans — list all plans (including hidden)
billingAdmin.get('/plans', async (c) => {
  const plans = await db.query.billingPlans.findMany({
    orderBy: (p, { asc }) => asc(p.sortOrder),
  });
  return c.json(plans);
});

// POST /plans — create a new plan
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
});

billingAdmin.post('/plans', async (c) => {
  const body = await c.req.json();
  const parsed = createPlanSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const [plan] = await insertReturning(billingPlans, parsed.data);
  return c.json(plan, 201);
});

// PATCH /plans/:id — update a plan
billingAdmin.patch('/plans/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = createPlanSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const [updated] = await updateReturning(billingPlans, {
    ...parsed.data,
    updatedAt: new Date(),
  }, eq(billingPlans.id, id));

  if (!updated) {
    return c.json({ error: 'Plan not found' }, 404);
  }

  return c.json(updated);
});

// DELETE /plans/:id — soft-delete (set visible: false)
billingAdmin.delete('/plans/:id', async (c) => {
  const id = c.req.param('id');
  const [updated] = await updateReturning(billingPlans, {
    visible: false,
    updatedAt: new Date(),
  }, eq(billingPlans.id, id));

  if (!updated) {
    return c.json({ error: 'Plan not found' }, 404);
  }

  return c.json({ message: 'Plan hidden', plan: updated });
});

// POST /plans/:id/sync-stripe — sync a single plan to Stripe
billingAdmin.post('/plans/:id/sync-stripe', async (c) => {
  const id = c.req.param('id');
  try {
    await stripeSyncService.syncPlanToStripe(id);
    return c.json({ message: 'Plan synced to Stripe' });
  } catch (err) {
    logger.error({ err, planId: id }, 'Failed to sync plan to Stripe');
    return c.json({ error: 'Failed to sync plan to Stripe' }, 500);
  }
});

// POST /plans/sync-all — sync all plans to Stripe
billingAdmin.post('/plans/sync-all', async (c) => {
  try {
    const result = await stripeSyncService.syncAllPlans();
    return c.json({ message: `${result.synced} plan(s) synced to Stripe` });
  } catch (err) {
    logger.error({ err }, 'Failed to sync all plans to Stripe');
    return c.json({ error: 'Sync failed' }, 500);
  }
});

// ─── Usage Pricing ───────────────────────────────────────────────────────────

// GET /pricing — get usage pricing config
billingAdmin.get('/pricing', async (c) => {
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
});

// PATCH /pricing — update usage rates
const pricingSchema = z.object({
  cpuCentsPerHour: z.number().int().min(0).optional(),
  memoryCentsPerGbHour: z.number().int().min(0).optional(),
  storageCentsPerGbMonth: z.number().int().min(0).optional(),
  bandwidthCentsPerGb: z.number().int().min(0).optional(),
  containerCentsPerHour: z.number().int().min(0).optional(),
  domainMarkupPercent: z.number().int().min(0).max(100).optional(),
  backupStorageCentsPerGb: z.number().int().min(0).optional(),
  locationPricingEnabled: z.boolean().optional(),
});

billingAdmin.patch('/pricing', async (c) => {
  const body = await c.req.json();
  const parsed = pricingSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const existing = await db.query.pricingConfig.findFirst();
  if (existing) {
    const [updated] = await updateReturning(pricingConfig, {
      ...parsed.data,
      updatedAt: new Date(),
    }, eq(pricingConfig.id, existing.id));
    return c.json(updated);
  }

  const [created] = await insertReturning(pricingConfig, parsed.data);
  return c.json(created, 201);
});

// ─── Location Multipliers ────────────────────────────────────────────────────

// GET /locations — list location multipliers
billingAdmin.get('/locations', async (c) => {
  const locations = await db.query.locationMultipliers.findMany();
  return c.json(locations);
});

// POST /locations — add a location
const locationSchema = z.object({
  locationKey: z.string().min(1),
  label: z.string().min(1),
  multiplier: z.number().int().min(1).default(100),
});

billingAdmin.post('/locations', async (c) => {
  const body = await c.req.json();
  const parsed = locationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const [location] = await insertReturning(locationMultipliers, parsed.data);
  return c.json(location, 201);
});

// PATCH /locations/:id — update multiplier
billingAdmin.patch('/locations/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const parsed = locationSchema.partial().safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const [updated] = await updateReturning(locationMultipliers, parsed.data, eq(locationMultipliers.id, id));
  if (!updated) {
    return c.json({ error: 'Location not found' }, 404);
  }
  return c.json(updated);
});

// DELETE /locations/:id — remove a location
billingAdmin.delete('/locations/:id', async (c) => {
  const id = c.req.param('id');
  const [deleted] = await deleteReturning(locationMultipliers, eq(locationMultipliers.id, id));
  if (!deleted) {
    return c.json({ error: 'Location not found' }, 404);
  }
  return c.json({ message: 'Location removed' });
});

// ─── Resource Limits ─────────────────────────────────────────────────────────

// GET /resource-limits — get global defaults
billingAdmin.get('/resource-limits', async (c) => {
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
  });
});

// PATCH /resource-limits — update global defaults
const resourceLimitsSchema = z.object({
  maxCpuPerContainer: z.number().int().min(0).nullable().optional(),
  maxMemoryPerContainer: z.number().int().min(0).nullable().optional(),
  maxReplicas: z.number().int().min(0).nullable().optional(),
  maxContainers: z.number().int().min(0).nullable().optional(),
  maxStorageGb: z.number().int().min(0).nullable().optional(),
  maxBandwidthGb: z.number().int().min(0).nullable().optional(),
  maxNfsStorageGb: z.number().int().min(0).nullable().optional(),
});

billingAdmin.patch('/resource-limits', async (c) => {
  const body = await c.req.json();
  const parsed = resourceLimitsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const existing = await db.query.resourceLimits.findFirst({
    where: isNull(resourceLimits.accountId),
  });

  if (existing) {
    const [updated] = await updateReturning(resourceLimits, {
      ...parsed.data,
      updatedAt: new Date(),
    }, eq(resourceLimits.id, existing.id));
    return c.json(updated);
  }

  const [created] = await insertReturning(resourceLimits, {
    accountId: null,
    ...parsed.data,
  });
  return c.json(created, 201);
});

// GET /resource-limits/:accountId — get per-account override
billingAdmin.get('/resource-limits/:accountId', async (c) => {
  const accountId = c.req.param('accountId');
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
    },
  });
});

// PATCH /resource-limits/:accountId — set per-account override
billingAdmin.patch('/resource-limits/:accountId', async (c) => {
  const accountId = c.req.param('accountId');
  const body = await c.req.json();
  const parsed = resourceLimitsSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const existing = await db.query.resourceLimits.findFirst({
    where: eq(resourceLimits.accountId, accountId),
  });

  if (existing) {
    const [updated] = await updateReturning(resourceLimits, {
      ...parsed.data,
      updatedAt: new Date(),
    }, eq(resourceLimits.id, existing.id));
    return c.json(updated);
  }

  const [created] = await insertReturning(resourceLimits, {
    accountId,
    ...parsed.data,
  });
  return c.json(created, 201);
});

// DELETE /resource-limits/:accountId — remove per-account override (falls back to global)
billingAdmin.delete('/resource-limits/:accountId', async (c) => {
  const accountId = c.req.param('accountId');
  const [deleted] = await deleteReturning(resourceLimits, eq(resourceLimits.accountId, accountId));
  if (!deleted) {
    return c.json({ error: 'Override not found' }, 404);
  }
  return c.json({ message: 'Account override removed, global limits apply' });
});

// ─── Account Billing Overrides (Discounts) ──────────────────────────────────

// GET /account-overrides — list all overrides
billingAdmin.get('/account-overrides', async (c) => {
  const overrides = await db.query.accountBillingOverrides.findMany({
    with: { account: true },
  });
  return c.json(overrides);
});

// GET /account-overrides/:accountId — get override for a specific account
billingAdmin.get('/account-overrides/:accountId', async (c) => {
  const accountId = c.req.param('accountId');
  const override = await db.query.accountBillingOverrides.findFirst({
    where: eq(accountBillingOverrides.accountId, accountId),
  });
  return c.json(override ?? null);
});

// PATCH /account-overrides/:accountId — create or update account override
const overrideSchema = z.object({
  discountPercent: z.number().int().min(0).max(100).optional(),
  customPriceCents: z.number().int().min(0).nullable().optional(),
  notes: z.string().nullable().optional(),
  cpuCentsPerHourOverride: z.number().int().min(0).nullable().optional(),
  memoryCentsPerGbHourOverride: z.number().int().min(0).nullable().optional(),
  storageCentsPerGbMonthOverride: z.number().int().min(0).nullable().optional(),
  bandwidthCentsPerGbOverride: z.number().int().min(0).nullable().optional(),
  containerCentsPerHourOverride: z.number().int().min(0).nullable().optional(),
});

billingAdmin.patch('/account-overrides/:accountId', async (c) => {
  const accountId = c.req.param('accountId');
  const body = await c.req.json();
  const parsed = overrideSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const existing = await db.query.accountBillingOverrides.findFirst({
    where: eq(accountBillingOverrides.accountId, accountId),
  });

  if (existing) {
    const [updated] = await updateReturning(accountBillingOverrides, {
      ...parsed.data,
      updatedAt: new Date(),
    }, eq(accountBillingOverrides.id, existing.id));
    return c.json(updated);
  }

  const [created] = await insertReturning(accountBillingOverrides, {
    accountId,
    ...parsed.data,
  });
  return c.json(created, 201);
});

// DELETE /account-overrides/:accountId — remove account override
billingAdmin.delete('/account-overrides/:accountId', async (c) => {
  const accountId = c.req.param('accountId');
  const [deleted] = await deleteReturning(accountBillingOverrides, eq(accountBillingOverrides.accountId, accountId));
  if (!deleted) {
    return c.json({ error: 'Override not found' }, 404);
  }
  return c.json({ message: 'Account billing override removed' });
});

// ─── Subscriptions Overview ──────────────────────────────────────────────────

// GET /subscriptions — list all subscriptions (paginated)
billingAdmin.get('/subscriptions', async (c) => {
  const subs = await db.query.subscriptions.findMany({
    with: { account: true, plan: true },
    orderBy: (s, { desc: d }) => d(s.createdAt),
  });
  return c.json(subs);
});

// ─── Metered Prices ──────────────────────────────────────────────────────────

// POST /metered-prices — create/update metered Stripe prices
billingAdmin.post('/metered-prices', async (c) => {
  try {
    await stripeSyncService.ensureMeteredPrices();
    return c.json({ message: 'Metered prices created in Stripe' });
  } catch (err) {
    logger.error({ err }, 'Failed to create metered prices');
    return c.json({ error: 'Failed to create metered prices' }, 500);
  }
});

export default billingAdmin;
