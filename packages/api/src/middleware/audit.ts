import { createMiddleware } from 'hono/factory';
import { db, auditLog } from '@hoster/db';
import type { AuthUser } from './auth.js';

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

  const user = c.get('user');
  const accountId = c.get('accountId');

  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown';

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
      console.error('Failed to write audit log:', err);
    });
});
