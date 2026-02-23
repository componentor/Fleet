import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { hash, verify } from 'argon2';
import { db, users, userAccounts, updateReturning, eq, and, isNull } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

const userRoutes = new OpenAPIHono<{
  Variables: { user: AuthUser };
}>();

userRoutes.use('*', authMiddleware);

// ── Schemas ──

const userProfileSchema = z.object({
  id: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isSuper: z.boolean().nullable(),
  createdAt: z.any(),
  updatedAt: z.any(),
}).openapi('UserProfile');

const updateProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  avatarUrl: z.string().url().nullable().optional(),
}).openapi('UpdateProfileRequest');

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
}).openapi('ChangePasswordRequest');

const accountWithRoleSchema = z.any().openapi('AccountWithRole');

// ── Route definitions ──

const getMeRoute = createRoute({
  method: 'get',
  path: '/me',
  tags: ['Users'],
  summary: 'Get current user profile',
  security: bearerSecurity,
  responses: {
    200: jsonContent(userProfileSchema, 'Current user profile'),
    ...standardErrors,
  },
});

const updateMeRoute = createRoute({
  method: 'patch',
  path: '/me',
  tags: ['Users'],
  summary: 'Update current user profile',
  security: bearerSecurity,
  request: {
    body: jsonBody(updateProfileSchema),
  },
  responses: {
    200: jsonContent(userProfileSchema, 'Updated user profile'),
    ...standardErrors,
  },
});

const changePasswordRoute = createRoute({
  method: 'put',
  path: '/me/password',
  tags: ['Users'],
  summary: 'Change current user password',
  security: bearerSecurity,
  request: {
    body: jsonBody(changePasswordSchema),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Password updated successfully'),
    ...standardErrors,
  },
});

const listMyAccountsRoute = createRoute({
  method: 'get',
  path: '/me/accounts',
  tags: ['Users'],
  summary: 'List accounts the current user belongs to',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(accountWithRoleSchema), 'List of accounts with roles'),
    ...standardErrors,
  },
});

// ── Route handlers ──

// GET /me — get current user profile
userRoutes.openapi(getMeRoute, (async (c: any) => {
  const authUser = c.get('user');

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
    isSuper: user.isSuper,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  });
}) as any);

// PATCH /me — update profile
userRoutes.openapi(updateMeRoute, (async (c: any) => {
  const authUser = c.get('user');
  const data = c.req.valid('json');

  const [updated] = await updateReturning(users, {
    ...data,
    updatedAt: new Date(),
  }, eq(users.id, authUser.userId));

  if (!updated) {
    return c.json({ error: 'User not found' }, 404);
  }

  return c.json({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    avatarUrl: updated.avatarUrl,
    isSuper: updated.isSuper,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });
}) as any);

// PUT /me/password — change password
userRoutes.openapi(changePasswordRoute, (async (c: any) => {
  const authUser = c.get('user');
  const data = c.req.valid('json');

  const user = await db.query.users.findFirst({
    where: and(eq(users.id, authUser.userId), isNull(users.deletedAt)),
  });

  if (!user || !user.passwordHash) {
    return c.json({ error: 'Password change not available for OAuth-only accounts' }, 400);
  }

  const valid = await verify(user.passwordHash, data.currentPassword);
  if (!valid) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }

  const newHash = await hash(data.newPassword);

  await db
    .update(users)
    .set({ passwordHash: newHash, securityChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, authUser.userId));

  return c.json({ message: 'Password updated successfully' });
}) as any);

// GET /me/accounts — list all accounts user belongs to
userRoutes.openapi(listMyAccountsRoute, (async (c: any) => {
  const authUser = c.get('user');

  const memberships = await db.query.userAccounts.findMany({
    where: eq(userAccounts.userId, authUser.userId),
    with: { account: true },
  });

  return c.json(
    memberships.map((m: any) => ({
      ...m.account,
      role: m.role,
    })),
  );
}) as any);

export default userRoutes;
