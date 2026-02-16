import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';
import { verify } from 'argon2';
import { db, apiKeys, users, eq } from '@fleet/db';

export interface AuthUser {
  userId: string;
  email: string;
  isSuper: boolean;
}

export const authMiddleware = createMiddleware<{
  Variables: {
    user: AuthUser;
    apiKeyAccountId?: string;
  };
}>(async (c, next) => {
  const authorization = c.req.header('Authorization');
  const apiKeyHeader = c.req.header('X-API-Key');

  // Try JWT first
  if (authorization?.startsWith('Bearer ')) {
    const token = authorization.slice(7);
    const jwtSecret = process.env['JWT_SECRET'];
    if (!jwtSecret) throw new Error('JWT_SECRET environment variable is not set');

    try {
      const secret = new TextEncoder().encode(jwtSecret);
      const { payload } = await jwtVerify(token, secret);
      c.set('user', {
        userId: payload['userId'] as string,
        email: payload['email'] as string,
        isSuper: payload['isSuper'] as boolean,
      });
      await next();
      return;
    } catch {
      return c.json({ error: 'Invalid or expired token' }, 401);
    }
  }

  // Fallback: API key auth
  if (apiKeyHeader) {
    const prefix = apiKeyHeader.slice(0, 14);

    const candidates = await db.query.apiKeys.findMany({
      where: eq(apiKeys.keyPrefix, prefix),
    });

    for (const candidate of candidates) {
      if (candidate.expiresAt && new Date(candidate.expiresAt) < new Date()) continue;

      const valid = await verify(candidate.keyHash, apiKeyHeader);
      if (!valid) continue;

      const creator = await db.query.users.findFirst({
        where: eq(users.id, candidate.createdBy),
      });
      if (!creator) continue;

      // Update lastUsedAt (fire and forget)
      db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, candidate.id)).catch(() => {});

      c.set('user', {
        userId: creator.id,
        email: creator.email,
        isSuper: creator.isSuper ?? false,
      });
      c.set('apiKeyAccountId' as any, candidate.accountId);
      await next();
      return;
    }

    return c.json({ error: 'Invalid API key' }, 401);
  }

  return c.json({ error: 'Missing or invalid authorization header' }, 401);
});
