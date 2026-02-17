import { createMiddleware } from 'hono/factory';
import { getConnInfo } from '@hono/node-server/conninfo';
import { db, auditLog } from '@fleet/db';
import type { AuthUser } from './auth.js';
import { logger } from '../services/logger.js';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const auditMiddleware = createMiddleware<{
  Variables: {
    user: AuthUser;
    accountId: string | null;
  };
}>(async (c, next) => {
  await next();

  // Only log mutating requests
  if (!MUTATING_METHODS.has(c.req.method)) {
    return;
  }

  let user: AuthUser | undefined;
  let accountId: string | null = null;
  try {
    user = c.get('user');
    accountId = c.get('accountId');
  } catch {
    // Variables not set (unauthenticated route)
  }

  let ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    null;

  if (!ip) {
    try {
      const conn = getConnInfo(c);
      ip = conn.remote.address ?? null;
    } catch {
      // conninfo not available
    }
  }

  ip ??= 'unknown';

  const method = c.req.method;
  const path = new URL(c.req.url).pathname;

  // Fire-and-forget: insert into audit log table
  db.insert(auditLog)
    .values({
      userId: user?.userId ?? null,
      accountId: accountId ?? null,
      action: `${method} ${path}`,
      resourceType: path.split('/')[3] ?? 'unknown',
      ipAddress: ip,
      details: { status: c.res.status },
    })
    .catch((err) => {
      logger.error({ err }, 'Failed to write audit log');
    });
});
