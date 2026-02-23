import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, sshKeys, sshAccessRules, services, insertReturning, updateReturning, eq, and, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { sshService } from '../services/ssh.service.js';
import { requireMember } from '../middleware/rbac.js';
import { logger } from '../services/logger.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

const sshRoutes = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

sshRoutes.use('*', authMiddleware);
sshRoutes.use('*', tenantMiddleware);

// --- Schemas ---

const addKeySchema = z.object({
  name: z.string().min(1).max(255),
  publicKey: z.string().min(1),
});

const updateRulesSchema = z.object({
  allowedIps: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
});

const keyIdParamSchema = z.object({
  id: z.string().openapi({ description: 'SSH key ID' }),
});

const serviceIdParamSchema = z.object({
  serviceId: z.string().openapi({ description: 'Service ID' }),
});

// --- Route definitions ---

const listKeysRoute = createRoute({
  method: 'get',
  path: '/keys',
  tags: ['SSH Keys'],
  summary: 'List user SSH keys',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.any()), 'List of SSH keys'),
    ...standardErrors,
  },
});

const addKeyRoute = createRoute({
  method: 'post',
  path: '/keys',
  tags: ['SSH Keys'],
  summary: 'Add SSH key',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    body: jsonBody(addKeySchema),
  },
  responses: {
    ...standardErrors,
    201: jsonContent(z.any(), 'SSH key created'),
    400: jsonContent(errorResponseSchema, 'Validation error'),
    409: jsonContent(errorResponseSchema, 'Duplicate key'),
  },
});

const getKeyRoute = createRoute({
  method: 'get',
  path: '/keys/{id}',
  tags: ['SSH Keys'],
  summary: 'Get SSH key details',
  security: bearerSecurity,
  request: {
    params: keyIdParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'SSH key details'),
    404: jsonContent(errorResponseSchema, 'Not found'),
  },
});

const deleteKeyRoute = createRoute({
  method: 'delete',
  path: '/keys/{id}',
  tags: ['SSH Keys'],
  summary: 'Remove SSH key',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    params: keyIdParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(messageResponseSchema, 'SSH key removed'),
    404: jsonContent(errorResponseSchema, 'Not found'),
  },
});

const getServiceRulesRoute = createRoute({
  method: 'get',
  path: '/services/{serviceId}/rules',
  tags: ['SSH Keys'],
  summary: 'Get SSH access rules for a service',
  security: bearerSecurity,
  request: {
    params: serviceIdParamSchema,
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'SSH access rules'),
    400: jsonContent(errorResponseSchema, 'Account context required'),
    404: jsonContent(errorResponseSchema, 'Service not found'),
  },
});

const updateServiceRulesRoute = createRoute({
  method: 'put',
  path: '/services/{serviceId}/rules',
  tags: ['SSH Keys'],
  summary: 'Update SSH access rules for a service',
  security: bearerSecurity,
  middleware: [requireMember] as const,
  request: {
    params: serviceIdParamSchema,
    body: jsonBody(updateRulesSchema),
  },
  responses: {
    ...standardErrors,
    200: jsonContent(z.any(), 'Updated SSH access rules'),
    201: jsonContent(z.any(), 'Created SSH access rules'),
    400: jsonContent(errorResponseSchema, 'Validation error or account context required'),
    404: jsonContent(errorResponseSchema, 'Service not found'),
  },
});

// --- Route handlers ---

// GET /keys — list user's SSH keys
sshRoutes.openapi(listKeysRoute, (async (c: any) => {
  const user = c.get('user');

  const keys = await db.query.sshKeys.findMany({
    where: eq(sshKeys.userId, user.userId),
    orderBy: (k: any, { desc }: any) => desc(k.createdAt),
  });

  return c.json(keys);
}) as any);

// POST /keys — add SSH key
sshRoutes.openapi(addKeyRoute, (async (c: any) => {
  const user = c.get('user');
  const { name, publicKey } = c.req.valid('json');

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

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.SSH_KEY_ADDED,
    description: `Added SSH key '${name}'`,
    resourceType: 'ssh_key',
    resourceId: key.id,
    resourceName: name,
  });

  return c.json(key, 201);
}) as any);

// GET /keys/:id — get SSH key details
sshRoutes.openapi(getKeyRoute, (async (c: any) => {
  const user = c.get('user');
  const { id: keyId } = c.req.valid('param');

  const key = await db.query.sshKeys.findFirst({
    where: and(eq(sshKeys.id, keyId), eq(sshKeys.userId, user.userId)),
  });

  if (!key) {
    return c.json({ error: 'SSH key not found' }, 404);
  }

  return c.json(key);
}) as any);

// DELETE /keys/:id — remove SSH key
sshRoutes.openapi(deleteKeyRoute, (async (c: any) => {
  const user = c.get('user');
  const { id: keyId } = c.req.valid('param');

  const key = await db.query.sshKeys.findFirst({
    where: and(eq(sshKeys.id, keyId), eq(sshKeys.userId, user.userId)),
  });

  if (!key) {
    return c.json({ error: 'SSH key not found' }, 404);
  }

  await db.delete(sshKeys).where(eq(sshKeys.id, keyId));
  logger.info({ userId: user.userId, keyId }, 'SSH key removed');

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.SSH_KEY_REMOVED,
    description: `Removed SSH key`,
    resourceType: 'ssh_key',
    resourceId: keyId,
  });

  return c.json({ message: 'SSH key removed' });
}) as any);

// --- SSH Access Rules (per service) ---

// GET /services/:serviceId/rules — get IP allowlist for a service
sshRoutes.openapi(getServiceRulesRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');

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
}) as any);

// PUT /services/:serviceId/rules — update IP allowlist
sshRoutes.openapi(updateServiceRulesRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { serviceId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const data = c.req.valid('json');

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
      allowedIps: data.allowedIps,
      enabled: data.enabled,
      updatedAt: new Date(),
    }, eq(sshAccessRules.id, existing.id));

    return c.json(updated);
  }

  const [created] = await insertReturning(sshAccessRules, {
    serviceId,
    allowedIps: data.allowedIps,
    enabled: data.enabled,
  });

  return c.json(created, 201);
}) as any);

export default sshRoutes;
