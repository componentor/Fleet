import { createMiddleware } from 'hono/factory';
import { db, adminRoles, eq } from '@fleet/db';
import type { AuthUser } from './auth.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';

export type AdminSection =
  | 'dashboard'
  | 'nodes'
  | 'status'
  | 'users'
  | 'accounts'
  | 'services'
  | 'storage'
  | 'marketplace'
  | 'events'
  | 'errors'
  | 'jobs'
  | 'billing'
  | 'resellers'
  | 'statusPosts'
  | 'emailTemplates'
  | 'sharedDomains'
  | 'settings'
  | 'updates'
  | 'support'
  | 'roles'
  | 'database';

export type AdminPermissionLevel = 'read' | 'write' | 'impersonate';

export type AdminPermissions = Partial<Record<AdminSection, AdminPermissionLevel[]>>;

/**
 * Middleware that loads admin role permissions into context.
 * Should run after authMiddleware and the admin guard.
 */
export const loadAdminPermissions = createMiddleware<{
  Variables: {
    user: AuthUser;
    adminPermissions: AdminPermissions | null;
  };
}>(async (c, next) => {
  const user = c.get('user');

  if (user.isSuper) {
    // Super admins bypass all permission checks
    c.set('adminPermissions' as any, null);
    await next();
    return;
  }

  if (!user.adminRoleId) {
    return c.json({ error: 'Admin access required' }, 403);
  }

  const role = await db.query.adminRoles.findFirst({
    where: eq(adminRoles.id, user.adminRoleId),
  });

  if (!role) {
    return c.json({ error: 'Admin role not found' }, 403);
  }

  const permissions = (typeof role.permissions === 'string'
    ? JSON.parse(role.permissions)
    : role.permissions) as AdminPermissions;

  c.set('adminPermissions' as any, permissions);
  await next();
});

/**
 * Middleware factory: require a specific permission level for a section.
 * Super admins always pass. Role-based admins are checked.
 */
export function requireAdminPermission(section: AdminSection, level: AdminPermissionLevel) {
  return async (c: any, next: () => Promise<void>) => {
    const user = c.get('user') as AuthUser;

    // Super admins bypass all checks
    if (user.isSuper) {
      return next();
    }

    const permissions = c.get('adminPermissions') as AdminPermissions | null;

    if (!permissions) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const sectionPerms = permissions[section];
    if (!sectionPerms || !sectionPerms.includes(level)) {
      const ctx = eventContext(c);
      eventService.log({
        ...ctx,
        eventType: EventTypes.ADMIN_PERMISSION_DENIED,
        description: `Admin permission denied: ${section}:${level} for ${ctx.actorEmail ?? 'unknown'}`,
        source: 'system',
        details: { section, level, method: c.req.method, path: c.req.path },
      });
      return c.json({ error: 'Insufficient permissions' }, 403);
    }

    return next();
  };
}

/**
 * Middleware: only allow super admins (isSuper = true).
 * Used for sensitive operations like managing roles and toggling isSuper.
 */
export function requireSuperAdmin() {
  return async (c: any, next: () => Promise<void>) => {
    const user = c.get('user') as AuthUser;
    if (!user.isSuper) {
      const ctx = eventContext(c);
      eventService.log({
        ...ctx,
        eventType: EventTypes.ADMIN_PERMISSION_DENIED,
        description: `Super admin access denied for ${ctx.actorEmail ?? 'unknown'}`,
        source: 'system',
        details: { requiredLevel: 'super', method: c.req.method, path: c.req.path },
      });
      return c.json({ error: 'Super admin access required' }, 403);
    }
    return next();
  };
}

/**
 * Check if the current user has a specific admin permission.
 * Utility for use inside route handlers.
 */
export function hasAdminPermission(c: any, section: AdminSection, level: AdminPermissionLevel): boolean {
  const user = c.get('user') as AuthUser;
  if (user.isSuper) return true;

  const permissions = c.get('adminPermissions') as AdminPermissions | null;
  if (!permissions) return false;

  const sectionPerms = permissions[section];
  return !!sectionPerms && sectionPerms.includes(level);
}
