import { Hono } from 'hono';
import { z } from 'zod';
import { hash, verify } from 'argon2';
import { db, users, userAccounts, updateReturning, eq } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';

const userRoutes = new Hono<{
  Variables: { user: AuthUser };
}>();

userRoutes.use('*', authMiddleware);

// GET /me — get current user profile
userRoutes.get('/me', async (c) => {
  const authUser = c.get('user');

  const user = await db.query.users.findFirst({
    where: eq(users.id, authUser.userId),
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
});

// PATCH /me — update profile
const updateProfileSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  avatarUrl: z.string().url().nullable().optional(),
});

userRoutes.patch('/me', async (c) => {
  const authUser = c.get('user');
  const body = await c.req.json();
  const parsed = updateProfileSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const [updated] = await updateReturning(users, {
    ...parsed.data,
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
});

// PUT /me/password — change password
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

userRoutes.put('/me/password', async (c) => {
  const authUser = c.get('user');
  const body = await c.req.json();
  const parsed = changePasswordSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed', details: parsed.error.flatten() }, 400);
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, authUser.userId),
  });

  if (!user || !user.passwordHash) {
    return c.json({ error: 'Password change not available for OAuth-only accounts' }, 400);
  }

  const valid = await verify(user.passwordHash, parsed.data.currentPassword);
  if (!valid) {
    return c.json({ error: 'Current password is incorrect' }, 401);
  }

  const newHash = await hash(parsed.data.newPassword);

  await db
    .update(users)
    .set({ passwordHash: newHash, updatedAt: new Date() })
    .where(eq(users.id, authUser.userId));

  return c.json({ message: 'Password updated successfully' });
});

// GET /me/accounts — list all accounts user belongs to
userRoutes.get('/me/accounts', async (c) => {
  const authUser = c.get('user');

  const memberships = await db.query.userAccounts.findMany({
    where: eq(userAccounts.userId, authUser.userId),
    with: { account: true },
  });

  return c.json(
    memberships.map((m) => ({
      ...m.account,
      role: m.role,
    })),
  );
});

export default userRoutes;
