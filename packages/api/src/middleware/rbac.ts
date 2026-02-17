import { createMiddleware } from 'hono/factory';
import type { AuthUser } from './auth.js';

type AccountRole = 'viewer' | 'member' | 'admin' | 'owner';

const ROLE_LEVEL: Record<AccountRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export function requireRole(minimumRole: AccountRole) {
  return createMiddleware<{
    Variables: {
      user: AuthUser;
      accountId: string | null;
      userRole: string;
    };
  }>(async (c, next) => {
    const user = c.get('user');

    // Super users bypass all RBAC checks
    if (user.isSuper) {
      await next();
      return;
    }

    const userRole = (c.get('userRole') ?? 'viewer') as AccountRole;
    const userLevel = ROLE_LEVEL[userRole] ?? 0;
    const requiredLevel = ROLE_LEVEL[minimumRole] ?? 0;

    if (userLevel < requiredLevel) {
      return c.json(
        { error: `Insufficient permissions. Requires ${minimumRole} role or higher.` },
        403,
      );
    }

    await next();
  });
}

export const requireViewer = requireRole('viewer');
export const requireMember = requireRole('member');
export const requireAdmin = requireRole('admin');
export const requireOwner = requireRole('owner');
