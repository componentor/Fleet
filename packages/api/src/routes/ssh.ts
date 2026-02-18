import { Hono } from 'hono';
import { z } from 'zod';
import { db, sshKeys, sshAccessRules, services, insertReturning, updateReturning, eq, and, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { sshService } from '../services/ssh.service.js';
import { requireMember } from '../middleware/rbac.js';
import { logger } from '../services/logger.js';

const sshRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

sshRoutes.use('*', authMiddleware);
sshRoutes.use('*', tenantMiddleware);

// --- SSH Key Management ---

// GET /keys — list user's SSH keys
sshRoutes.get('/keys', async (c) => {
  const user = c.get('user');

  const keys = await db.query.sshKeys.findMany({
    where: eq(sshKeys.userId, user.userId),
    orderBy: (k, { desc }) => desc(k.createdAt),
  });

  return c.json(keys);
});

// POST /keys — add SSH key
const addKeySchema = z.object({
  name: z.string().min(1).max(255),
  publicKey: z.string().min(1),
});

sshRoutes.post('/keys', requireMember, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const parsed = addKeySchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { name, publicKey } = parsed.data;

  // Validate key format
  const validation = sshService.validateKey(publicKey);
  if (!validation.valid) {
    return c.json({ error: validation.error }, 400);
  }

  // Generate fingerprint
  const fingerprint = sshService.generateFingerprint(publicKey);

  // Check for duplicate fingerprint
  const existing = await db.query.sshKeys.findFirst({
    where: and(eq(sshKeys.userId, user.userId), eq(sshKeys.fingerprint, fingerprint)),
  });

  if (existing) {
    return c.json({ error: 'This SSH key is already registered' }, 409);
  }

  const [key] = await insertReturning(sshKeys, {
    userId: user.userId,
    name,
    publicKey: publicKey.trim(),
    fingerprint,
  });

  logger.info({ userId: user.userId, keyId: key.id, fingerprint }, 'SSH key added');
  return c.json(key, 201);
});

// GET /keys/:id — get SSH key details
sshRoutes.get('/keys/:id', async (c) => {
  const user = c.get('user');
  const keyId = c.req.param('id');

  const key = await db.query.sshKeys.findFirst({
    where: and(eq(sshKeys.id, keyId), eq(sshKeys.userId, user.userId)),
  });

  if (!key) {
    return c.json({ error: 'SSH key not found' }, 404);
  }

  return c.json(key);
});

// DELETE /keys/:id — remove SSH key
sshRoutes.delete('/keys/:id', requireMember, async (c) => {
  const user = c.get('user');
  const keyId = c.req.param('id');

  const key = await db.query.sshKeys.findFirst({
    where: and(eq(sshKeys.id, keyId), eq(sshKeys.userId, user.userId)),
  });

  if (!key) {
    return c.json({ error: 'SSH key not found' }, 404);
  }

  await db.delete(sshKeys).where(eq(sshKeys.id, keyId));
  logger.info({ userId: user.userId, keyId }, 'SSH key removed');
  return c.json({ message: 'SSH key removed' });
});

// --- SSH Access Rules (per service) ---

// GET /services/:serviceId/rules — get IP allowlist for a service
sshRoutes.get('/services/:serviceId/rules', async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Verify service belongs to this account
  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  const rules = await db.query.sshAccessRules.findFirst({
    where: eq(sshAccessRules.serviceId, serviceId),
  });

  return c.json(rules ?? { serviceId, allowedIps: [], enabled: false });
});

// PUT /services/:serviceId/rules — update IP allowlist
const updateRulesSchema = z.object({
  allowedIps: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

sshRoutes.put('/services/:serviceId/rules', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const serviceId = c.req.param('serviceId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = updateRulesSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  // Verify service belongs to this account
  const svc = await db.query.services.findFirst({
    where: and(eq(services.id, serviceId), eq(services.accountId, accountId), isNull(services.deletedAt)),
  });

  if (!svc) {
    return c.json({ error: 'Service not found' }, 404);
  }

  const existing = await db.query.sshAccessRules.findFirst({
    where: eq(sshAccessRules.serviceId, serviceId),
  });

  if (existing) {
    const [updated] = await updateReturning(sshAccessRules, {
      allowedIps: parsed.data.allowedIps,
      enabled: parsed.data.enabled,
      updatedAt: new Date(),
    }, eq(sshAccessRules.id, existing.id));

    return c.json(updated);
  }

  const [created] = await insertReturning(sshAccessRules, {
    serviceId,
    allowedIps: parsed.data.allowedIps,
    enabled: parsed.data.enabled,
  });

  return c.json(created, 201);
});

export default sshRoutes;
