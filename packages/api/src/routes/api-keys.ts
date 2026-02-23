import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { randomBytes } from 'node:crypto';
import { z } from '@hono/zod-openapi';
import { hash } from 'argon2';
import { db, apiKeys, insertReturning, deleteReturning, eq, and } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireAdmin } from '../middleware/rbac.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { logger } from '../services/logger.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, bearerSecurity } from './_schemas.js';

const apiKeyRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'api-key' });

const apiKeyRoutes = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

apiKeyRoutes.use('*', authMiddleware);
apiKeyRoutes.use('*', tenantMiddleware);

// ── Schemas ──

const apiKeyItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().nullable().or(z.date().nullable()),
  expiresAt: z.string().nullable().or(z.date().nullable()),
  createdAt: z.string().nullable().or(z.date().nullable()),
}).openapi('ApiKeyItem');

const apiKeyListSchema = z.array(apiKeyItemSchema).openapi('ApiKeyList');

const createApiKeyBodySchema = z.object({
  name: z.string().min(1),
  expiresInDays: z.number().int().min(1).optional(),
  scopes: z.array(z.enum(['read', 'write', 'admin'])).min(1).default(['read', 'write']),
}).openapi('CreateApiKeyRequest');

const createdApiKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  key: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.string().nullable().or(z.date().nullable()),
}).openapi('CreatedApiKey');

const idParamSchema = z.object({
  id: z.string().openapi({ description: 'API key ID', example: 'abc-123' }),
}).openapi('ApiKeyIdParam');

// ── Route definitions ──

const listKeysRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['API Keys'],
  summary: 'List API keys for the current account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(apiKeyListSchema, 'List of API keys (metadata only, no secrets)'),
    400: jsonContent(errorResponseSchema, 'Account context required'),
  },
});

const createKeyRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['API Keys'],
  summary: 'Create a new API key',
  security: bearerSecurity,
  middleware: [apiKeyRateLimit, requireAdmin] as const,
  request: {
    body: jsonBody(createApiKeyBodySchema),
  },
  responses: {
    201: jsonContent(createdApiKeySchema, 'API key created (includes raw key, shown only once)'),
    400: jsonContent(errorResponseSchema, 'Validation error or account context required'),
  },
});

const deleteKeyRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['API Keys'],
  summary: 'Revoke an API key',
  security: bearerSecurity,
  middleware: [requireAdmin] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'API key revoked'),
    400: jsonContent(errorResponseSchema, 'Account context required'),
    404: jsonContent(errorResponseSchema, 'API key not found'),
  },
});

// ── Route handlers ──

// GET / — list API keys (no actual key values, just metadata)
apiKeyRoutes.openapi(listKeysRoute, async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const keys = await db.query.apiKeys.findMany({
    where: eq(apiKeys.accountId, accountId),
    orderBy: (k, { desc: d }) => d(k.createdAt),
  });

  return c.json(keys.map(k => ({
    id: k.id,
    name: k.name,
    keyPrefix: k.keyPrefix,
    scopes: k.scopes as string[],
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    createdAt: k.createdAt,
  })), 200);
});

// POST / — create a new API key
apiKeyRoutes.openapi(createKeyRoute, async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const { name, expiresInDays, scopes } = c.req.valid('json');

  const rawKey = `fleet_${randomBytes(32).toString('hex')}`;
  const keyPrefix = rawKey.slice(0, 14);
  const keyHash = await hash(rawKey);

  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const [created] = await insertReturning(apiKeys, {
    accountId,
    createdBy: user.userId,
    name,
    keyPrefix,
    keyHash,
    scopes,
    expiresAt,
  });

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.API_KEY_CREATED,
    description: `Created API key '${name}'`,
    resourceType: 'api_key',
    resourceId: created.id,
    resourceName: name,
  });

  return c.json({
    id: created.id,
    name: created.name,
    key: rawKey,
    keyPrefix,
    scopes,
    createdAt: created.createdAt,
  }, 201);
});

// DELETE /:id — revoke an API key
apiKeyRoutes.openapi(deleteKeyRoute, async (c) => {
  const accountId = c.get('accountId');
  const { id: keyId } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const [deleted] = await deleteReturning(apiKeys, and(eq(apiKeys.id, keyId), eq(apiKeys.accountId, accountId))!);
  if (!deleted) return c.json({ error: 'API key not found' }, 404);

  logger.info({ keyId, accountId, revokedBy: c.get('user').userId }, 'API key revoked');

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.API_KEY_REVOKED,
    description: `Revoked API key '${deleted.name}'`,
    resourceType: 'api_key',
    resourceId: keyId,
    resourceName: deleted.name,
  });

  return c.json({ message: 'API key revoked' }, 200);
});

export default apiKeyRoutes;
