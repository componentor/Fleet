import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hash } from 'argon2';
import { db, apiKeys, insertReturning, deleteReturning, eq, and } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireAdmin } from '../middleware/rbac.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { logger } from '../services/logger.js';

const apiKeyRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'api-key' });

const VALID_SCOPES = ['read', 'write', 'admin'] as const;

const apiKeyRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

apiKeyRoutes.use('*', authMiddleware);
apiKeyRoutes.use('*', tenantMiddleware);

// GET / — list API keys (no actual key values, just metadata)
apiKeyRoutes.get('/', async (c) => {
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
    scopes: k.scopes,
    lastUsedAt: k.lastUsedAt,
    expiresAt: k.expiresAt,
    createdAt: k.createdAt,
  })));
});

// POST / — create a new API key
const createApiKeySchema = z.object({
  name: z.string().min(1),
  expiresInDays: z.number().int().min(1).optional(),
  scopes: z.array(z.enum(['read', 'write', 'admin'])).min(1).default(['read', 'write']),
});

apiKeyRoutes.post('/', apiKeyRateLimit, requireAdmin, async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const body = await c.req.json();
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { name, expiresInDays, scopes } = parsed.data;

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
apiKeyRoutes.delete('/:id', requireAdmin, async (c) => {
  const accountId = c.get('accountId');
  const keyId = c.req.param('id');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const [deleted] = await deleteReturning(apiKeys, and(eq(apiKeys.id, keyId), eq(apiKeys.accountId, accountId))!);
  if (!deleted) return c.json({ error: 'API key not found' }, 404);

  logger.info({ keyId, accountId, revokedBy: c.get('user').userId }, 'API key revoked');
  return c.json({ message: 'API key revoked' });
});

export default apiKeyRoutes;
