import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, adminRoles, users, insertReturning, updateReturning, countSql, eq, and, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { loadAdminPermissions, requireSuperAdmin } from '../middleware/admin-permission.js';
import type { AdminPermissions } from '../middleware/admin-permission.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';
import {
  jsonBody,
  jsonContent,
  errorResponseSchema,
  messageResponseSchema,
  standardErrors,
  bearerSecurity,
} from './_schemas.js';

type Env = {
  Variables: { user: AuthUser; adminPermissions: AdminPermissions | null };
};

const adminRoleRoutes = new OpenAPIHono<Env>();

// All routes require auth + admin access
adminRoleRoutes.use('*', authMiddleware);
adminRoleRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper && !user.adminRoleId) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  await next();
});
adminRoleRoutes.use('*', loadAdminPermissions);

// ── Schemas ──

const roleIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Role ID' }),
});

const createRoleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(255).optional(),
  permissions: z.record(z.string(), z.array(z.string())),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(255).optional().nullable(),
  permissions: z.record(z.string(), z.array(z.string())).optional(),
});

const assignRoleSchema = z.object({
  adminRoleId: z.string().nullable(),
});

const userIdParamSchema = z.object({
  id: z.string().openapi({ description: 'User ID' }),
});

// ── Routes ──

// GET /roles — list all roles
const listRolesRoute = createRoute({
  method: 'get',
  path: '/roles',
  tags: ['Admin Roles'],
  summary: 'List all admin roles',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'List of admin roles'),
    ...standardErrors,
  },
});

adminRoleRoutes.openapi(listRolesRoute, (async (c: any) => {
  const roles = await db.query.adminRoles.findMany({
    orderBy: (r: any, { asc }: any) => asc(r.name),
  });

  // Count users per role
  const rolesWithCounts = await Promise.all(
    roles.map(async (role: any) => {
      const [count] = await db
        .select({ count: countSql() })
        .from(users)
        .where(and(eq(users.adminRoleId, role.id), isNull(users.deletedAt)));
      return {
        ...role,
        userCount: count?.count ?? 0,
      };
    }),
  );

  return c.json(rolesWithCounts);
}) as any);

// GET /roles/:id — get a single role
const getRoleRoute = createRoute({
  method: 'get',
  path: '/roles/{id}',
  tags: ['Admin Roles'],
  summary: 'Get a single admin role',
  security: bearerSecurity,
  request: {
    params: roleIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Admin role details'),
    ...standardErrors,
  },
});

adminRoleRoutes.openapi(getRoleRoute, (async (c: any) => {
  const { id } = c.req.valid('param');

  const role = await db.query.adminRoles.findFirst({
    where: eq(adminRoles.id, id),
  });

  if (!role) {
    return c.json({ error: 'Role not found' }, 404);
  }

  const [count] = await db
    .select({ count: countSql() })
    .from(users)
    .where(and(eq(users.adminRoleId, id), isNull(users.deletedAt)));

  return c.json({ ...role, userCount: count?.count ?? 0 });
}) as any);

// POST /roles — create a new role (super admin only)
const createRoleRoute = createRoute({
  method: 'post',
  path: '/roles',
  tags: ['Admin Roles'],
  summary: 'Create a new admin role',
  security: bearerSecurity,
  request: {
    body: jsonBody(createRoleSchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Created admin role'),
    ...standardErrors,
  },
  middleware: [requireSuperAdmin()],
});

adminRoleRoutes.openapi(createRoleRoute, (async (c: any) => {
  const body = c.req.valid('json');

  // Check for duplicate name
  const existing = await db.query.adminRoles.findFirst({
    where: eq(adminRoles.name, body.name),
  });

  if (existing) {
    return c.json({ error: 'A role with this name already exists' }, 409);
  }

  const [role] = await insertReturning(adminRoles, {
    name: body.name,
    description: body.description ?? null,
    permissions: body.permissions,
    isBuiltin: false,
  });

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.ADMIN_ROLE_CREATED,
    description: `Created admin role "${body.name}"`,
    resourceType: 'admin_role',
    resourceId: role!.id,
    resourceName: body.name,
  });

  return c.json(role, 201);
}) as any);

// PATCH /roles/:id — update a role (super admin only)
const updateRoleRoute = createRoute({
  method: 'patch',
  path: '/roles/{id}',
  tags: ['Admin Roles'],
  summary: 'Update an admin role',
  security: bearerSecurity,
  request: {
    params: roleIdParamSchema,
    body: jsonBody(updateRoleSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated admin role'),
    ...standardErrors,
  },
  middleware: [requireSuperAdmin()],
});

adminRoleRoutes.openapi(updateRoleRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await db.query.adminRoles.findFirst({
    where: eq(adminRoles.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Role not found' }, 404);
  }

  // Check duplicate name
  if (body.name && body.name !== existing.name) {
    const dup = await db.query.adminRoles.findFirst({
      where: eq(adminRoles.name, body.name),
    });
    if (dup) {
      return c.json({ error: 'A role with this name already exists' }, 409);
    }
  }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.permissions !== undefined) updates.permissions = body.permissions;

  const [updated] = await updateReturning(adminRoles, updates, eq(adminRoles.id, id));

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.ADMIN_ROLE_UPDATED,
    description: `Updated admin role "${updated!.name}"`,
    resourceType: 'admin_role',
    resourceId: id,
    resourceName: updated!.name,
  });

  return c.json(updated);
}) as any);

// DELETE /roles/:id — delete a role (super admin only)
const deleteRoleRoute = createRoute({
  method: 'delete',
  path: '/roles/{id}',
  tags: ['Admin Roles'],
  summary: 'Delete an admin role',
  security: bearerSecurity,
  request: {
    params: roleIdParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Role deleted'),
    ...standardErrors,
  },
  middleware: [requireSuperAdmin()],
});

adminRoleRoutes.openapi(deleteRoleRoute, (async (c: any) => {
  const { id } = c.req.valid('param');

  const role = await db.query.adminRoles.findFirst({
    where: eq(adminRoles.id, id),
  });

  if (!role) {
    return c.json({ error: 'Role not found' }, 404);
  }

  if (role.isBuiltin) {
    return c.json({ error: 'Cannot delete built-in roles' }, 400);
  }

  // Check if users are assigned
  const [count] = await db
    .select({ count: countSql() })
    .from(users)
    .where(and(eq(users.adminRoleId, id), isNull(users.deletedAt)));

  if ((count?.count ?? 0) > 0) {
    return c.json({ error: 'Cannot delete a role that has users assigned. Remove users from this role first.' }, 400);
  }

  await db.delete(adminRoles).where(eq(adminRoles.id, id));

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.ADMIN_ROLE_DELETED,
    description: `Deleted admin role "${role.name}"`,
    resourceType: 'admin_role',
    resourceId: id,
    resourceName: role.name,
  });

  return c.json({ message: 'Role deleted' });
}) as any);

// GET /my-permissions — get resolved permissions for current admin user
const myPermissionsRoute = createRoute({
  method: 'get',
  path: '/my-permissions',
  tags: ['Admin Roles'],
  summary: 'Get resolved permissions for current admin user',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Resolved permissions'),
    ...standardErrors,
  },
});

adminRoleRoutes.openapi(myPermissionsRoute, (async (c: any) => {
  const user = c.get('user');

  if (user.isSuper) {
    return c.json({ isSuper: true, permissions: null });
  }

  const permissions = c.get('adminPermissions');
  return c.json({ isSuper: false, permissions });
}) as any);

// PATCH /users/:id/role — assign/remove admin role (super admin only)
const assignRoleRoute = createRoute({
  method: 'patch',
  path: '/users/{id}/role',
  tags: ['Admin Roles'],
  summary: 'Assign or remove admin role from a user',
  security: bearerSecurity,
  request: {
    params: userIdParamSchema,
    body: jsonBody(assignRoleSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated user'),
    ...standardErrors,
  },
  middleware: [requireSuperAdmin()],
});

adminRoleRoutes.openapi(assignRoleRoute, (async (c: any) => {
  const { id: targetUserId } = c.req.valid('param');
  const { adminRoleId } = c.req.valid('json');

  const targetUser = await db.query.users.findFirst({
    where: and(eq(users.id, targetUserId), isNull(users.deletedAt)),
  });

  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Validate role exists if assigning
  if (adminRoleId) {
    const role = await db.query.adminRoles.findFirst({
      where: eq(adminRoles.id, adminRoleId),
    });
    if (!role) {
      return c.json({ error: 'Role not found' }, 404);
    }
  }

  const [updated] = await updateReturning(
    users,
    { adminRoleId, securityChangedAt: new Date(), updatedAt: new Date() },
    eq(users.id, targetUserId),
  );

  eventService.log({
    ...eventContext(c),
    eventType: adminRoleId ? EventTypes.ADMIN_ROLE_ASSIGNED : EventTypes.ADMIN_ROLE_REMOVED,
    description: adminRoleId
      ? `Assigned admin role to ${targetUser.email}`
      : `Removed admin role from ${targetUser.email}`,
    resourceType: 'user',
    resourceId: targetUserId,
    resourceName: targetUser.email ?? undefined,
  });

  return c.json({
    id: updated!.id,
    email: updated!.email,
    name: updated!.name,
    isSuper: updated!.isSuper,
    adminRoleId: (updated as any).adminRoleId ?? null,
  });
}) as any);

export default adminRoleRoutes;
