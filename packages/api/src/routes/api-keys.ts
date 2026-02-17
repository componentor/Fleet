import { Hono } from 'hono';
import { randomBytes } from 'node:crypto';
import { hash } from 'argon2';
import { db, apiKeys, insertReturning, deleteReturning, eq, and } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireAdmin } from '../middleware/rbac.js';

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
apiKeyRoutes.post('/', requireAdmin, async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const body = await c.req.json() as { name: string; expiresInDays?: number };
  if (!body.name) return c.json({ error: 'name is required' }, 400);

  const rawKey = `fleet_${randomBytes(32).toString('hex')}`;
  const keyPrefix = rawKey.slice(0, 14);
  const keyHash = await hash(rawKey);

  const expiresAt = body.expiresInDays
    ? new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const [created] = await insertReturning(apiKeys, {
    accountId,
    createdBy: user.userId,
    name: body.name,
    keyPrefix,
    keyHash,
    scopes: ['*'],
    expiresAt,
  });

  return c.json({
    id: created.id,
    name: created.name,
    key: rawKey,
    keyPrefix,
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

  return c.json({ message: 'API key revoked' });
});

export default apiKeyRoutes;
