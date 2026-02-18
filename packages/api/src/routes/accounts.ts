import { Hono } from 'hono';
import { z } from 'zod';
import { verify } from 'argon2';
import { db, accounts, userAccounts, users, services, auditLog, insertReturning, updateReturning, deleteReturning, eq, like, and, isNull, isNotNull, safeTransaction } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { generateTokens, setRefreshTokenCookie } from './auth.js';
import { cache, invalidateCache } from '../middleware/cache.js';
import { dockerService } from '../services/docker.service.js';
import { logger } from '../services/logger.js';

const accountRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

accountRoutes.use('*', authMiddleware);

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// GET / — list accounts the current user has access to
accountRoutes.get('/', async (c) => {
  const user = c.get('user');

  if (user.isSuper) {
    const allAccounts = await db.query.accounts.findMany({
      where: isNull(accounts.deletedAt),
      orderBy: (a, { asc }) => asc(a.path),
      limit: 500,
    });
    const sanitized = allAccounts.map(({ stripeCustomerId, ...rest }) => rest);
    return c.json(sanitized);
  }

  const memberships = await db.query.userAccounts.findMany({
    where: eq(userAccounts.userId, user.userId),
    with: { account: true },
  });

  return c.json(memberships.map((m) => {
    const { stripeCustomerId, ...rest } = m.account;
    return { ...rest, role: m.role };
  }));
});

// POST / — create a sub-account
const createAccountSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).optional(),
  parentId: z.string().uuid().optional(),
  trustRevocable: z.boolean().optional(),
});

accountRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const parsed = createAccountSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { name, trustRevocable } = parsed.data;
  let { parentId } = parsed.data;

  if (!parentId) {
    parentId = c.req.header('X-Account-Id') ?? undefined;
  }

  let parentPath = '';
  let depth = 0;

  if (parentId) {
    const parent = await db.query.accounts.findFirst({
      where: and(eq(accounts.id, parentId), isNull(accounts.deletedAt)),
    });

    if (!parent) {
      return c.json({ error: 'Parent account not found' }, 404);
    }

    if (!user.isSuper) {
      const membership = await db.query.userAccounts.findFirst({
        where: (ua, { and, eq: e }) =>
          and(e(ua.userId, user.userId), e(ua.accountId, parentId!)),
      });

      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        return c.json({ error: 'You must be an owner or admin to create sub-accounts' }, 403);
      }
    }

    parentPath = parent.path ?? parent.slug ?? '';
    depth = (parent.depth ?? 0) + 1;
  }

  const slug = parsed.data.slug ?? slugify(name) + '-' + Date.now().toString(36);
  const path = parentPath ? `${parentPath}.${slug}` : slug;

  const existingSlug = await db.query.accounts.findFirst({
    where: and(eq(accounts.slug, slug), isNull(accounts.deletedAt)),
  });

  if (existingSlug) {
    return c.json({ error: 'Account slug already exists' }, 409);
  }

  // Create account and link user as owner in a single transaction
  let account: any;
  await safeTransaction(async (tx) => {
    [account] = await tx.insert(accounts).values({
      name,
      slug,
      parentId: parentId ?? null,
      path,
      depth,
      trustRevocable: trustRevocable ?? false,
      status: 'active',
    }).returning();

    if (!account) {
      throw new Error('Failed to create account');
    }

    await tx.insert(userAccounts).values({
      userId: user.userId,
      accountId: account.id,
      role: 'owner',
    });
  });

  if (!account) {
    return c.json({ error: 'Failed to create account' }, 500);
  }

  return c.json(account, 201);
});

// GET /:id — get account details
accountRoutes.get('/:id', tenantMiddleware, cache(60), async (c) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const fullAccount = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, account.id), isNull(accounts.deletedAt)),
  });

  if (fullAccount) {
    const { stripeCustomerId, ...rest } = fullAccount;
    return c.json(rest);
  }

  return c.json(fullAccount);
});

// PATCH /:id — update account
accountRoutes.patch('/:id', tenantMiddleware, async (c) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const updateSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    trustRevocable: z.boolean().optional(),
    status: z.enum(['active', 'suspended', 'pending']).optional(),
  });

  const body = await c.req.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const [updated] = await updateReturning(accounts, {
    ...parsed.data,
    updatedAt: new Date(),
  }, eq(accounts.id, account.id));

  await invalidateCache(`GET:/accounts/${account.id}:*`);

  if (updated) {
    const { stripeCustomerId, ...rest } = updated;
    return c.json(rest);
  }

  return c.json(updated);
});

// DELETE /:id — schedule account for deletion (30-day grace period)
accountRoutes.delete('/:id', tenantMiddleware, async (c) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const user = c.get('user');

  // Require password confirmation
  const body = await c.req.json().catch(() => ({}));
  const { password } = body as { password?: string };
  if (!password) {
    return c.json({ error: 'Password confirmation required to delete account' }, 400);
  }

  // Verify password against the authenticated user
  const dbUser = await db.query.users.findFirst({
    where: and(eq(users.id, user.userId), isNull(users.deletedAt)),
  });
  if (!dbUser?.passwordHash) {
    return c.json({ error: 'Cannot verify identity' }, 400);
  }

  const valid = await verify(dbUser.passwordHash, password);
  if (!valid) {
    return c.json({ error: 'Invalid password' }, 403);
  }

  if (!user.isSuper) {
    const membership = await db.query.userAccounts.findFirst({
      where: (ua, { and, eq: e }) =>
        and(e(ua.userId, user.userId), e(ua.accountId, account.id)),
    });

    if (!membership || membership.role !== 'owner') {
      return c.json({ error: 'Only account owners can delete accounts' }, 403);
    }
  }

  // Schedule deletion for 30 days from now
  const scheduledDate = new Date();
  scheduledDate.setDate(scheduledDate.getDate() + 30);

  const descendants = await db.query.accounts.findMany({
    where: and(like(accounts.path, `${account.path}.%`), isNull(accounts.deletedAt)),
    limit: 1000,
  });

  const allAccountIds = [account.id, ...descendants.map((d) => d.id)];

  // Mark all accounts as scheduled for deletion and stop their services
  await safeTransaction(async (tx) => {
    for (const accId of allAccountIds) {
      await tx.update(accounts).set({
        scheduledDeletionAt: scheduledDate,
        status: 'pending_deletion',
        updatedAt: new Date(),
      }).where(eq(accounts.id, accId));

      // Mark all services as stopped within the same transaction
      const accountServices = await tx.query.services.findMany({
        where: and(eq(services.accountId, accId), isNull(services.deletedAt)),
      });

      for (const svc of accountServices) {
        await tx.update(services).set({
          status: 'stopped',
          stoppedAt: new Date(),
          updatedAt: new Date(),
        }).where(eq(services.id, svc.id));
      }
    }
  });

  // Scale down Docker services outside the transaction (Docker calls are not transactional)
  for (const accId of allAccountIds) {
    const accountServices = await db.query.services.findMany({
      where: and(eq(services.accountId, accId), isNull(services.deletedAt)),
    });

    for (const svc of accountServices) {
      if (svc.dockerServiceId && svc.status !== 'stopped') {
        try {
          await dockerService.scaleService(svc.dockerServiceId, 0);
        } catch (err) {
          logger.error({ err, serviceId: svc.id }, 'Failed to stop service during deletion scheduling');
        }
      }
    }
  }

  await invalidateCache(`GET:/accounts/${account.id}:*`);

  return c.json({
    message: 'Account scheduled for deletion',
    scheduledDeletionAt: scheduledDate.toISOString(),
  });
});

// POST /:id/revoke-deletion — cancel scheduled deletion
accountRoutes.post('/:id/revoke-deletion', tenantMiddleware, async (c) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const user = c.get('user');

  if (!user.isSuper) {
    const membership = await db.query.userAccounts.findFirst({
      where: (ua, { and, eq: e }) =>
        and(e(ua.userId, user.userId), e(ua.accountId, account.id)),
    });

    if (!membership || membership.role !== 'owner') {
      return c.json({ error: 'Only account owners can revoke deletion' }, 403);
    }
  }

  const fullAccount = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, account.id), isNull(accounts.deletedAt)),
  });

  if (!fullAccount?.scheduledDeletionAt) {
    return c.json({ error: 'Account is not scheduled for deletion' }, 400);
  }

  const descendants = await db.query.accounts.findMany({
    where: and(like(accounts.path, `${account.path}.%`), isNull(accounts.deletedAt)),
    limit: 1000,
  });

  const allAccountIds = [account.id, ...descendants.map((d) => d.id)];

  await safeTransaction(async (tx) => {
    for (const accId of allAccountIds) {
      await tx.update(accounts).set({
        scheduledDeletionAt: null,
        status: 'active',
        updatedAt: new Date(),
      }).where(eq(accounts.id, accId));
    }
  });

  await invalidateCache(`GET:/accounts/${account.id}:*`);

  return c.json({ message: 'Account deletion revoked' });
});

// GET /:id/tree — full descendant tree
accountRoutes.get('/:id/tree', tenantMiddleware, async (c) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const self = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, account.id), isNull(accounts.deletedAt)),
  });

  const descendants = await db.query.accounts.findMany({
    where: and(like(accounts.path, `${account.path}.%`), isNull(accounts.deletedAt)),
    orderBy: (a, { asc }) => asc(a.depth),
    limit: 1000,
  });

  if (!self) {
    return c.json({ error: 'Account not found' }, 404);
  }

  type TreeNode = {
    account: typeof self;
    children: TreeNode[];
  };

  const nodeMap = new Map<string, TreeNode>();
  const root: TreeNode = { account: self, children: [] };
  nodeMap.set(self.id, root);

  for (const desc of descendants) {
    const node: TreeNode = { account: desc, children: [] };
    nodeMap.set(desc.id, node);

    if (desc.parentId) {
      const parent = nodeMap.get(desc.parentId);
      if (parent) {
        parent.children.push(node);
      }
    }
  }

  return c.json(root);
});

// POST /:id/disconnect — disconnect from parent
accountRoutes.post('/:id/disconnect', tenantMiddleware, async (c) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const fullAccount = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, account.id), isNull(accounts.deletedAt)),
  });

  if (!fullAccount) {
    return c.json({ error: 'Account not found' }, 404);
  }

  if (!fullAccount.parentId) {
    return c.json({ error: 'Account has no parent to disconnect from' }, 400);
  }

  if (!fullAccount.trustRevocable) {
    return c.json({ error: 'This account cannot disconnect from its parent' }, 403);
  }

  const newSlug = fullAccount.slug ?? '';
  const oldPath = fullAccount.path ?? '';

  await db
    .update(accounts)
    .set({
      parentId: null,
      path: newSlug,
      depth: 0,
      updatedAt: new Date(),
    })
    .where(eq(accounts.id, fullAccount.id));

  const descendants = await db.query.accounts.findMany({
    where: and(like(accounts.path, `${oldPath}.%`), isNull(accounts.deletedAt)),
    limit: 1000,
  });

  for (const desc of descendants) {
    const descPath = desc.path ?? '';
    const newDescPath = descPath.replace(oldPath, newSlug);
    const newDepth = newDescPath.split('.').length - 1;

    await db
      .update(accounts)
      .set({
        path: newDescPath,
        depth: newDepth,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, desc.id));
  }

  return c.json({ message: 'Successfully disconnected from parent account' });
});

// POST /:id/impersonate — super user enters account's panel
accountRoutes.post('/:id/impersonate', tenantMiddleware, async (c) => {
  const user = c.get('user');
  const account = c.get('account');

  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  if (!user.isSuper) {
    return c.json({ error: 'Only super admins can impersonate accounts' }, 403);
  }

  const fullUser = await db.query.users.findFirst({
    where: and(eq(users.id, user.userId), isNull(users.deletedAt)),
  });

  if (!fullUser) {
    return c.json({ error: 'User not found' }, 404);
  }

  const tokens = await generateTokens({
    userId: fullUser.id,
    email: fullUser.email!,
    isSuper: fullUser.isSuper ?? false,
    impersonatingAccountId: account.id,
  });

  setRefreshTokenCookie(c, tokens.refreshToken);

  return c.json({
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    accountId: account.id,
    name: account.name,
    slug: account.slug,
  });
});

// GET /:id/members — list members of the account
accountRoutes.get('/:id/members', tenantMiddleware, async (c) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const memberships = await db.query.userAccounts.findMany({
    where: eq(userAccounts.accountId, account.id),
    with: { user: true },
    limit: 500,
  });

  const members = memberships.map((m) => ({
    id: m.user.id,
    email: m.user.email,
    name: m.user.name,
    avatarUrl: m.user.avatarUrl,
    role: m.role,
    joinedAt: m.createdAt,
  }));

  return c.json(members);
});

// POST /:id/members — invite user to account
const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

accountRoutes.post('/:id/members', tenantMiddleware, async (c) => {
  const account = c.get('account');
  const authUser = c.get('user');

  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  if (!authUser.isSuper) {
    const inviterMembership = await db.query.userAccounts.findFirst({
      where: (ua, { and, eq: e }) =>
        and(e(ua.userId, authUser.userId), e(ua.accountId, account.id)),
    });

    if (!inviterMembership || (inviterMembership.role !== 'owner' && inviterMembership.role !== 'admin')) {
      return c.json({ error: 'Only owners and admins can invite members' }, 403);
    }
  }

  const body = await c.req.json();
  const parsed = inviteMemberSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { email, role } = parsed.data;

  const targetUser = await db.query.users.findFirst({
    where: and(eq(users.email, email), isNull(users.deletedAt)),
  });

  if (!targetUser) {
    return c.json({ error: 'User with this email not found. They must register first.' }, 404);
  }

  const existingMembership = await db.query.userAccounts.findFirst({
    where: (ua, { and, eq: e }) =>
      and(e(ua.userId, targetUser.id), e(ua.accountId, account.id)),
  });

  if (existingMembership) {
    return c.json({ error: 'User is already a member of this account' }, 409);
  }

  await db.insert(userAccounts).values({
    userId: targetUser.id,
    accountId: account.id,
    role,
  });

  return c.json({
    id: targetUser.id,
    email: targetUser.email,
    name: targetUser.name,
    role,
    message: 'Member added successfully',
  }, 201);
});

// PATCH /:id/members/:userId — change member role
accountRoutes.patch('/:id/members/:userId', tenantMiddleware, async (c) => {
  const account = c.get('account');
  const authUser = c.get('user');
  const targetUserId = c.req.param('userId');

  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const roleSchema = z.object({
    role: z.enum(['owner', 'admin', 'member', 'viewer']),
  });

  const body = await c.req.json();
  const parsed = roleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  if (!authUser.isSuper) {
    const authMembership = await db.query.userAccounts.findFirst({
      where: (ua, { and, eq: e }) =>
        and(e(ua.userId, authUser.userId), e(ua.accountId, account.id)),
    });

    if (!authMembership || authMembership.role !== 'owner') {
      return c.json({ error: 'Only account owners can change member roles' }, 403);
    }
  }

  const [updated] = await updateReturning(userAccounts, { role: parsed.data.role },
    and(
      eq(userAccounts.userId, targetUserId),
      eq(userAccounts.accountId, account.id),
    )!,
  );

  if (!updated) {
    return c.json({ error: 'Member not found in this account' }, 404);
  }

  return c.json({ message: 'Role updated', role: parsed.data.role });
});

// DELETE /:id/members/:userId — remove member from account
accountRoutes.delete('/:id/members/:userId', tenantMiddleware, async (c) => {
  const account = c.get('account');
  const authUser = c.get('user');
  const targetUserId = c.req.param('userId');

  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  if (targetUserId === authUser.userId) {
    const owners = await db.query.userAccounts.findMany({
      where: (ua, { and, eq: e }) =>
        and(e(ua.accountId, account.id), e(ua.role, 'owner')),
    });

    if (owners.length <= 1) {
      return c.json({ error: 'Cannot remove the last owner of an account' }, 400);
    }
  }

  if (!authUser.isSuper && targetUserId !== authUser.userId) {
    const authMembership = await db.query.userAccounts.findFirst({
      where: (ua, { and, eq: e }) =>
        and(e(ua.userId, authUser.userId), e(ua.accountId, account.id)),
    });

    if (!authMembership || (authMembership.role !== 'owner' && authMembership.role !== 'admin')) {
      return c.json({ error: 'Only owners and admins can remove members' }, 403);
    }
  }

  const deleted = await deleteReturning(
    userAccounts,
    and(
      eq(userAccounts.userId, targetUserId),
      eq(userAccounts.accountId, account.id),
    )!,
  );

  if (deleted.length === 0) {
    return c.json({ error: 'Member not found in this account' }, 404);
  }

  return c.json({ message: 'Member removed successfully' });
});

// GET /:id/my-role — get current user's role in this account
accountRoutes.get('/:id/my-role', tenantMiddleware, async (c) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const user = c.get('user');

  if (user.isSuper) {
    return c.json({ role: 'owner' });
  }

  const membership = await db.query.userAccounts.findFirst({
    where: and(eq(userAccounts.userId, user.userId), eq(userAccounts.accountId, account.id)),
  });

  if (!membership) {
    return c.json({ role: 'viewer' });
  }

  return c.json({ role: membership.role ?? 'member' });
});

// GET /:id/activity — account-scoped audit log
accountRoutes.get('/:id/activity', tenantMiddleware, async (c) => {
  const accountId = c.get('accountId');
  const paramId = c.req.param('id');

  if (!accountId || accountId !== paramId) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100);
  const offset = (page - 1) * limit;

  const logs = await db.query.auditLog.findMany({
    where: eq(auditLog.accountId, accountId),
    orderBy: (a, { desc: d }) => d(a.createdAt),
    limit,
    offset,
  });

  return c.json({ data: logs });
});

export default accountRoutes;
