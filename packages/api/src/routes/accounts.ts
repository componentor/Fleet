import { Hono } from 'hono';
import { z } from 'zod';
import { verify } from 'argon2';
import { db, accounts, userAccounts, users, services, auditLog, insertReturning, updateReturning, deleteReturning, countSql, eq, like, and, or, isNull, isNotNull, desc, gte, lte, safeTransaction } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireAdmin, requireOwner } from '../middleware/rbac.js';
import { generateTokens, setRefreshTokenCookie } from './auth.js';
import { cache, invalidateCache } from '../middleware/cache.js';
import { dockerService } from '../services/docker.service.js';
import { logger } from '../services/logger.js';
import { emailService } from '../services/email.service.js';
import { getEmailQueue, isQueueAvailable } from '../services/queue.service.js';
import type { EmailJobData } from '../workers/email.worker.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';

async function queueEmail(data: EmailJobData): Promise<void> {
  if (isQueueAvailable()) {
    await getEmailQueue().add('send-email', data);
  } else {
    emailService.sendTemplateEmail(data.templateSlug, data.to, data.variables, data.accountId)
      .catch((err) => logger.error({ err }, `Failed to send ${data.templateSlug} email`));
  }
}

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

  // Only super admins can create top-level (root) accounts
  if (!parentId && !user.isSuper) {
    return c.json({ error: 'Only platform administrators can create top-level accounts' }, 403);
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

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.ACCOUNT_CREATED,
    description: `Created account '${name}'`,
    resourceType: 'account',
    resourceId: account.id,
    resourceName: name,
  });

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
accountRoutes.patch('/:id', tenantMiddleware, requireAdmin, async (c) => {
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

  const user = c.get('user');

  // Only super admins can change account status (prevents self-un-suspend)
  if (parsed.data.status && !user.isSuper) {
    return c.json({ error: 'Only platform administrators can change account status' }, 403);
  }

  const [updated] = await updateReturning(accounts, {
    ...parsed.data,
    updatedAt: new Date(),
  }, eq(accounts.id, account.id));

  await invalidateCache(`GET:/accounts/${account.id}:*`);

  if (updated) {
    eventService.log({
      ...eventContext(c),
      eventType: EventTypes.ACCOUNT_UPDATED,
      description: `Updated account '${updated.name}'`,
      resourceType: 'account',
      resourceId: account.id,
      resourceName: updated.name,
    });

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

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.ACCOUNT_DELETION_SCHEDULED,
    description: `Scheduled account for deletion`,
    resourceType: 'account',
    resourceId: account.id,
  });

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
accountRoutes.post('/:id/disconnect', tenantMiddleware, requireOwner, async (c) => {
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

  // Update parent and all descendants atomically
  await safeTransaction(async (tx) => {
    await tx
      .update(accounts)
      .set({
        parentId: null,
        path: newSlug,
        depth: 0,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, fullAccount.id));

    const descendants = await tx.query.accounts.findMany({
      where: and(like(accounts.path, `${oldPath}.%`), isNull(accounts.deletedAt)),
      limit: 1000,
    });

    for (const desc of descendants) {
      const descPath = desc.path ?? '';
      const newDescPath = descPath.replace(oldPath, newSlug);
      const newDepth = newDescPath.split('.').length - 1;

      await tx
        .update(accounts)
        .set({
          path: newDescPath,
          depth: newDepth,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, desc.id));
    }
  });

  return c.json({ message: 'Successfully disconnected from parent account' });
});

// POST /:id/release/:childId — parent releases a child account
accountRoutes.post('/:id/release/:childId', tenantMiddleware, requireOwner, async (c) => {
  const account = c.get('account');
  if (!account) return c.json({ error: 'Account not found' }, 404);

  const childId = c.req.param('childId');
  const child = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, childId), isNull(accounts.deletedAt)),
  });

  if (!child) return c.json({ error: 'Child account not found' }, 404);
  if (child.parentId !== account.id) return c.json({ error: 'This account is not a child of your account' }, 403);

  const newSlug = child.slug ?? '';
  const oldPath = child.path ?? '';

  await safeTransaction(async (tx) => {
    await tx
      .update(accounts)
      .set({
        parentId: null,
        path: newSlug,
        depth: 0,
        updatedAt: new Date(),
      })
      .where(eq(accounts.id, child.id));

    const descendants = await tx.query.accounts.findMany({
      where: and(like(accounts.path, `${oldPath}.%`), isNull(accounts.deletedAt)),
      limit: 1000,
    });

    for (const desc of descendants) {
      const descPath = desc.path ?? '';
      const newDescPath = descPath.replace(oldPath, newSlug);
      const newDepth = newDescPath.split('.').length - 1;
      await tx
        .update(accounts)
        .set({ path: newDescPath, depth: newDepth, updatedAt: new Date() })
        .where(eq(accounts.id, desc.id));
    }
  });

  return c.json({ message: 'Child account released successfully' });
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

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.ACCOUNT_IMPERSONATED,
    description: `Impersonated account '${account.name}'`,
    resourceType: 'account',
    resourceId: account.id,
    resourceName: account.name,
  });

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

  let inviterRole: string = 'owner'; // Super users treated as owner
  if (!authUser.isSuper) {
    const inviterMembership = await db.query.userAccounts.findFirst({
      where: (ua, { and, eq: e }) =>
        and(e(ua.userId, authUser.userId), e(ua.accountId, account.id)),
    });

    if (!inviterMembership || (inviterMembership.role !== 'owner' && inviterMembership.role !== 'admin')) {
      return c.json({ error: 'Only owners and admins can invite members' }, 403);
    }
    inviterRole = inviterMembership.role ?? 'member';
  }

  const body = await c.req.json();
  const parsed = inviteMemberSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const { email, role } = parsed.data;

  // Prevent role escalation: admins cannot invite at admin level (only owners can)
  const ROLE_LEVELS: Record<string, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
  if ((ROLE_LEVELS[role] ?? 0) >= (ROLE_LEVELS[inviterRole] ?? 0)) {
    return c.json({ error: 'Cannot invite at a role equal to or higher than your own' }, 403);
  }

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

  try {
    await db.insert(userAccounts).values({
      userId: targetUser.id,
      accountId: account.id,
      role,
    });
  } catch (err: any) {
    if (err?.message?.includes('unique') || err?.message?.includes('UNIQUE') || err?.message?.includes('duplicate')) {
      return c.json({ error: 'User is already a member of this account' }, 409);
    }
    throw err;
  }

  // Send invite notification email
  const appUrl = process.env['APP_URL'] ?? 'http://localhost:5173';
  queueEmail({
    templateSlug: 'invite',
    to: targetUser.email,
    variables: {
      userName: targetUser.name ?? targetUser.email,
      accountName: account.name ?? account.slug,
      platformName: 'Fleet',
      inviteUrl: `${appUrl}/panel`,
    },
    accountId: account.id,
  }).catch((err) => logger.error({ err }, 'Failed to queue invite email'));

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.USER_INVITED,
    description: `Invited ${email} as ${role}`,
    resourceType: 'user',
    resourceName: email,
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

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.USER_ROLE_CHANGED,
    description: `Changed role to ${parsed.data.role}`,
    resourceType: 'user',
    resourceId: targetUserId,
  });

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
    const ROLE_LEVELS: Record<string, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

    const authMembership = await db.query.userAccounts.findFirst({
      where: (ua, { and, eq: e }) =>
        and(e(ua.userId, authUser.userId), e(ua.accountId, account.id)),
    });

    if (!authMembership || (authMembership.role !== 'owner' && authMembership.role !== 'admin')) {
      return c.json({ error: 'Only owners and admins can remove members' }, 403);
    }

    // Check target role — can only remove members below your own role level
    const targetMembership = await db.query.userAccounts.findFirst({
      where: (ua, { and, eq: e }) =>
        and(e(ua.userId, targetUserId), e(ua.accountId, account.id)),
    });

    if (targetMembership && (ROLE_LEVELS[targetMembership.role] ?? 0) >= (ROLE_LEVELS[authMembership.role] ?? 0)) {
      return c.json({ error: 'Cannot remove a member with a role equal to or higher than your own' }, 403);
    }
  }

  // Prevent removing the last owner (even for self-removal, already checked above, but also for super admins)
  if (targetUserId !== authUser.userId) {
    const targetMembership = await db.query.userAccounts.findFirst({
      where: (ua, { and, eq: e }) =>
        and(e(ua.userId, targetUserId), e(ua.accountId, account.id)),
    });

    if (targetMembership?.role === 'owner') {
      const owners = await db.query.userAccounts.findMany({
        where: (ua, { and, eq: e }) =>
          and(e(ua.accountId, account.id), e(ua.role, 'owner')),
      });

      if (owners.length <= 1) {
        return c.json({ error: 'Cannot remove the last owner of an account' }, 400);
      }
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

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.USER_REMOVED,
    description: `Removed member from account`,
    resourceType: 'user',
    resourceId: targetUserId,
  });

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

// GET /:id/activity — account-scoped audit log with filtering
accountRoutes.get('/:id/activity', tenantMiddleware, async (c) => {
  const accountId = c.get('accountId');
  const paramId = c.req.param('id');

  if (!accountId || accountId !== paramId) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const page = Math.max(1, Math.min(parseInt(c.req.query('page') ?? '1', 10) || 1, 10000));
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '20', 10) || 20), 100);
  const offset = (page - 1) * limit;

  const resourceType = c.req.query('resourceType');
  const eventType = c.req.query('eventType');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const search = c.req.query('search');

  const conditions: any[] = [eq(auditLog.accountId, accountId)];
  if (resourceType) conditions.push(eq(auditLog.resourceType, resourceType));
  if (eventType) conditions.push(like(auditLog.eventType, `${eventType}%`));
  if (dateFrom) conditions.push(gte(auditLog.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(auditLog.createdAt, new Date(dateTo)));
  if (search) {
    conditions.push(
      or(
        like(auditLog.description, `%${search}%`),
        like(auditLog.actorEmail, `%${search}%`),
        like(auditLog.resourceName, `%${search}%`),
      )
    );
  }

  const whereClause = and(...conditions);

  const logs = await db
    .select()
    .from(auditLog)
    .where(whereClause)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: countSql() })
    .from(auditLog)
    .where(whereClause);

  return c.json({
    data: logs,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  });
});

export default accountRoutes;
