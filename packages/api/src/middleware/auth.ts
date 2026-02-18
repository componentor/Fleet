import { createMiddleware } from 'hono/factory';
import { jwtVerify } from 'jose';
import { verify } from 'argon2';
import { db, apiKeys, users, eq, and, isNull } from '@fleet/db';
import { getValkey } from '../services/valkey.service.js';
import { logger } from '../services/logger.js';

export interface AuthUser {
  userId: string;
  email: string;
  isSuper: boolean;
  impersonatingAccountId?: string;
}

export const authMiddleware = createMiddleware<{
  Variables: {
    user: AuthUser;
    apiKeyAccountId?: string;
    apiKeyScopes?: string[];
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

      // Check token blocklist
      const valkey = await getValkey();
      if (valkey) {
        const blocked = await valkey.get(`blocklist:${token}`);
        if (blocked) {
          return c.json({ error: 'Token has been revoked' }, 401);
        }
      }

      c.set('user', {
        userId: payload['userId'] as string,
        email: payload['email'] as string,
        isSuper: payload['isSuper'] as boolean,
        impersonatingAccountId: payload['impersonatingAccountId'] as string | undefined,
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
        where: and(eq(users.id, candidate.createdBy), isNull(users.deletedAt)),
      });
      if (!creator) continue;

      // Update lastUsedAt (fire and forget — log failures)
      db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, candidate.id))
        .catch((err) => logger.error({ err }, 'Failed to update API key lastUsedAt'));

      c.set('user', {
        userId: creator.id,
        email: creator.email ?? '',
        isSuper: creator.isSuper ?? false,
      });
      c.set('apiKeyAccountId' as any, candidate.accountId);
      c.set('apiKeyScopes' as any, candidate.scopes ?? ['*']);
      await next();
      return;
    }

    return c.json({ error: 'Invalid API key' }, 401);
  }

  return c.json({ error: 'Missing or invalid authorization header' }, 401);
});

export function requireScope(scope: string) {
  return async (c: any, next: () => Promise<void>) => {
    const scopes = c.get('apiKeyScopes' as never) as string[] | undefined;
    // JWT-authenticated users get full access (scopes are an API key concept)
    // but we still check if the user has the 'write' scope implicitly through RBAC
    if (!scopes) return next();
    // Check if scopes include the required scope or '*' or 'admin'
    if (scopes.includes('*') || scopes.includes('admin') || scopes.includes(scope)) {
      return next();
    }
    return c.json({ error: `API key missing required scope: ${scope}` }, 403);
  };
}
