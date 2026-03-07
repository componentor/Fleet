import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { verify } from 'argon2';
import { db, accounts, userAccounts, users, services, auditLog, logArchives, platformSettings, billingPlans, subscriptions, billingConfig, insertReturning, updateReturning, deleteReturning, countSql, eq, like, and, or, isNull, isNotNull, desc, gte, lte, safeTransaction } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { requireAdmin, requireOwner } from '../middleware/rbac.js';
import { generateTokens, setRefreshTokenCookie } from './auth.js';
import { cache, invalidateCache } from '../middleware/cache.js';
import { orchestrator } from '../services/orchestrator.js';
import { logger, logToErrorTable } from '../services/logger.js';
import { emailService } from '../services/email.service.js';
import { getEmailQueue, isQueueAvailable } from '../services/queue.service.js';
import type { EmailJobData } from '../workers/email.worker.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';
import { getAppUrl } from '../services/platform.service.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

async function queueEmail(data: EmailJobData): Promise<void> {
  if (isQueueAvailable()) {
    await getEmailQueue().add('send-email', data);
  } else {
    emailService.sendTemplateEmail(data.templateSlug, data.to, data.variables, data.accountId)
      .catch((err) => logger.error({ err }, `Failed to send ${data.templateSlug} email`));
  }
}

const accountRoutes = new OpenAPIHono<{
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

// ── Schemas ──

const createAccountSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(255).optional(),
  parentId: z.string().uuid().optional(),
  trustRevocable: z.boolean().optional(),
}).openapi('CreateAccountRequest');

const updateAccountSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  trustRevocable: z.boolean().optional(),
  status: z.enum(['active', 'suspended', 'pending']).optional(),
}).openapi('UpdateAccountRequest');

const deleteAccountSchema = z.object({
  password: z.string().min(1),
}).openapi('DeleteAccountRequest');

const inviteMemberSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
}).openapi('InviteMemberRequest');

const changeMemberRoleSchema = z.object({
  role: z.enum(['owner', 'admin', 'member', 'viewer']),
}).openapi('ChangeMemberRoleRequest');

const idParamSchema = z.object({
  id: z.string().openapi({ description: 'Account ID' }),
});

const idAndUserIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Account ID' }),
  userId: z.string().openapi({ description: 'User ID' }),
});

const idAndChildIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Account ID' }),
  childId: z.string().openapi({ description: 'Child account ID' }),
});

const createSubAccountSchema = z.object({
  name: z.string().min(1).max(255),
  planId: z.string().uuid().optional(),
  billingCycle: z.string().min(1).optional(),
  inheritBilling: z.boolean().optional(),
  successUrl: z.string().url().optional(),
  cancelUrl: z.string().url().optional(),
}).openapi('CreateSubAccountRequest');

const activityQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  resourceType: z.string().optional(),
  eventType: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  search: z.string().optional(),
});

// ── Route definitions ──

const listAccountsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Accounts'],
  summary: 'List accounts the current user has access to',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.array(z.any()), 'List of accounts'),
    ...standardErrors,
  },
});

const createAccountRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Accounts'],
  summary: 'Create a sub-account',
  security: bearerSecurity,
  request: {
    body: jsonBody(createAccountSchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Created account'),
    ...standardErrors,
  },
});

const getAccountRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Accounts'],
  summary: 'Get account details',
  security: bearerSecurity,
  middleware: [tenantMiddleware, cache(60)] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Account details'),
    ...standardErrors,
  },
});

const updateAccountRoute = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Accounts'],
  summary: 'Update account',
  security: bearerSecurity,
  middleware: [tenantMiddleware, requireAdmin] as const,
  request: {
    params: idParamSchema,
    body: jsonBody(updateAccountSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated account'),
    ...standardErrors,
  },
});

const deleteAccountRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Accounts'],
  summary: 'Schedule account for deletion (30-day grace period)',
  security: bearerSecurity,
  middleware: [tenantMiddleware] as const,
  request: {
    params: idParamSchema,
    body: jsonBody(deleteAccountSchema),
  },
  responses: {
    200: jsonContent(z.object({ message: z.string(), scheduledDeletionAt: z.string() }), 'Account scheduled for deletion'),
    ...standardErrors,
  },
});

const revokeDeletionRoute = createRoute({
  method: 'post',
  path: '/{id}/revoke-deletion',
  tags: ['Accounts'],
  summary: 'Cancel scheduled account deletion',
  security: bearerSecurity,
  middleware: [tenantMiddleware] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Deletion revoked'),
    ...standardErrors,
  },
});

const getAccountTreeRoute = createRoute({
  method: 'get',
  path: '/{id}/tree',
  tags: ['Accounts'],
  summary: 'Get full descendant tree',
  security: bearerSecurity,
  middleware: [tenantMiddleware] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Account tree'),
    ...standardErrors,
  },
});

const disconnectAccountRoute = createRoute({
  method: 'post',
  path: '/{id}/disconnect',
  tags: ['Accounts'],
  summary: 'Disconnect account from parent',
  security: bearerSecurity,
  middleware: [tenantMiddleware, requireOwner] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Disconnected from parent'),
    ...standardErrors,
  },
});

const releaseChildRoute = createRoute({
  method: 'post',
  path: '/{id}/release/{childId}',
  tags: ['Accounts'],
  summary: 'Release a child account from parent',
  security: bearerSecurity,
  middleware: [tenantMiddleware, requireOwner] as const,
  request: {
    params: idAndChildIdParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Child account released'),
    ...standardErrors,
  },
});

const impersonateAccountRoute = createRoute({
  method: 'post',
  path: '/{id}/impersonate',
  tags: ['Accounts'],
  summary: 'Super user enters account panel',
  security: bearerSecurity,
  middleware: [tenantMiddleware] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.object({
      token: z.string(),
      accountId: z.string(),
      name: z.string().nullable(),
      slug: z.string().nullable(),
    }), 'Impersonation tokens'),
    ...standardErrors,
  },
});

const listMembersRoute = createRoute({
  method: 'get',
  path: '/{id}/members',
  tags: ['Accounts'],
  summary: 'List members of the account',
  security: bearerSecurity,
  middleware: [tenantMiddleware] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.array(z.any()), 'List of members'),
    ...standardErrors,
  },
});

const inviteMemberRoute = createRoute({
  method: 'post',
  path: '/{id}/members',
  tags: ['Accounts'],
  summary: 'Invite a user to the account',
  security: bearerSecurity,
  middleware: [tenantMiddleware] as const,
  request: {
    params: idParamSchema,
    body: jsonBody(inviteMemberSchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Member added'),
    ...standardErrors,
  },
});

const changeMemberRoleRoute = createRoute({
  method: 'patch',
  path: '/{id}/members/{userId}',
  tags: ['Accounts'],
  summary: 'Change member role',
  security: bearerSecurity,
  middleware: [tenantMiddleware] as const,
  request: {
    params: idAndUserIdParamSchema,
    body: jsonBody(changeMemberRoleSchema),
  },
  responses: {
    200: jsonContent(z.object({ message: z.string(), role: z.string() }), 'Role updated'),
    ...standardErrors,
  },
});

const removeMemberRoute = createRoute({
  method: 'delete',
  path: '/{id}/members/{userId}',
  tags: ['Accounts'],
  summary: 'Remove member from account',
  security: bearerSecurity,
  middleware: [tenantMiddleware] as const,
  request: {
    params: idAndUserIdParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Member removed'),
    ...standardErrors,
  },
});

const getMyRoleRoute = createRoute({
  method: 'get',
  path: '/{id}/my-role',
  tags: ['Accounts'],
  summary: 'Get current user role in this account',
  security: bearerSecurity,
  middleware: [tenantMiddleware] as const,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.object({ role: z.string() }), 'User role in account'),
    ...standardErrors,
  },
});

const getActivityRoute = createRoute({
  method: 'get',
  path: '/{id}/activity',
  tags: ['Accounts'],
  summary: 'Account-scoped audit log with filtering',
  security: bearerSecurity,
  middleware: [tenantMiddleware] as const,
  request: {
    params: idParamSchema,
    query: activityQuerySchema,
  },
  responses: {
    200: jsonContent(z.object({
      data: z.array(z.any()),
      pagination: z.object({
        page: z.number(),
        limit: z.number(),
        total: z.number(),
        totalPages: z.number(),
      }),
    }), 'Paginated audit log'),
    ...standardErrors,
  },
});

const createSubAccountRoute = createRoute({
  method: 'post',
  path: '/{id}/sub-accounts',
  tags: ['Accounts'],
  summary: 'Create a sub-account with billing plan',
  security: bearerSecurity,
  middleware: [tenantMiddleware] as const,
  request: {
    params: idParamSchema,
    body: jsonBody(createSubAccountSchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Created sub-account with subscription'),
    ...standardErrors,
  },
});

// ── Route handlers ──

// GET / — list accounts the current user has access to
accountRoutes.openapi(listAccountsRoute, (async (c: any) => {
  const user = c.get('user');

  if (user.isSuper) {
    const allAccounts = await db.query.accounts.findMany({
      where: isNull(accounts.deletedAt),
      orderBy: (a: any, { asc }: any) => asc(a.path),
      limit: 500,
    });
    const sanitized = allAccounts.map(({ stripeCustomerId, ...rest }: any) => rest);
    return c.json(sanitized);
  }

  const memberships = await db.query.userAccounts.findMany({
    where: eq(userAccounts.userId, user.userId),
    with: { account: true },
  });

  return c.json(memberships.map((m: any) => {
    const { stripeCustomerId, ...rest } = m.account;
    return { ...rest, role: m.role };
  }));
}) as any);

// POST / — create a sub-account
accountRoutes.openapi(createAccountRoute, (async (c: any) => {
  const user = c.get('user');
  const data = c.req.valid('json');

  const { name, trustRevocable } = data;
  let { parentId } = data;

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
        where: (ua: any, { and, eq: e }: any) =>
          and(e(ua.userId, user.userId), e(ua.accountId, parentId!)),
      });

      if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
        return c.json({ error: 'You must be an owner or admin to create sub-accounts' }, 403);
      }
    }

    parentPath = parent.path ?? parent.slug ?? '';
    depth = (parent.depth ?? 0) + 1;
  }

  const slug = data.slug ?? slugify(name) + '-' + Date.now().toString(36);
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
}) as any);

// GET /:id — get account details
accountRoutes.openapi(getAccountRoute, (async (c: any) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const fullAccount = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, account.id), isNull(accounts.deletedAt)),
  });

  if (fullAccount) {
    const { stripeCustomerId, ...rest } = fullAccount as any;
    return c.json(rest);
  }

  return c.json(fullAccount);
}) as any);

// PATCH /:id — update account
accountRoutes.openapi(updateAccountRoute, (async (c: any) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const data = c.req.valid('json');
  const user = c.get('user');

  // Only super admins can change account status (prevents self-un-suspend)
  if (data.status && !user.isSuper) {
    return c.json({ error: 'Only platform administrators can change account status' }, 403);
  }

  const [updated] = await updateReturning(accounts, {
    ...data,
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

    const { stripeCustomerId, ...rest } = updated as any;
    return c.json(rest);
  }

  return c.json(updated);
}) as any);

// DELETE /:id — schedule account for deletion (30-day grace period)
accountRoutes.openapi(deleteAccountRoute, (async (c: any) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const user = c.get('user');
  const { password } = c.req.valid('json');

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
      where: (ua: any, { and, eq: e }: any) =>
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

  const allAccountIds = [account.id, ...descendants.map((d: any) => d.id)];

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
          await orchestrator.scaleService(svc.dockerServiceId, 0);
        } catch (err) {
          logger.error({ err, serviceId: svc.id }, 'Failed to stop service during deletion scheduling');
          logToErrorTable({ level: 'error', message: `Service scale-to-0 during deletion scheduling failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'accounts', operation: 'deletion-scheduling-scale-to-zero' } });
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
}) as any);

// POST /:id/revoke-deletion — cancel scheduled deletion
accountRoutes.openapi(revokeDeletionRoute, (async (c: any) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const user = c.get('user');

  if (!user.isSuper) {
    const membership = await db.query.userAccounts.findFirst({
      where: (ua: any, { and, eq: e }: any) =>
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

  const allAccountIds = [account.id, ...descendants.map((d: any) => d.id)];

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
}) as any);

// GET /:id/tree — full descendant tree
accountRoutes.openapi(getAccountTreeRoute, (async (c: any) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const self = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, account.id), isNull(accounts.deletedAt)),
  });

  const descendants = await db.query.accounts.findMany({
    where: and(like(accounts.path, `${account.path}.%`), isNull(accounts.deletedAt)),
    orderBy: (a: any, { asc }: any) => asc(a.depth),
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

  for (const d of descendants) {
    const node: TreeNode = { account: d, children: [] };
    nodeMap.set(d.id, node);

    if (d.parentId) {
      const parent = nodeMap.get(d.parentId);
      if (parent) {
        parent.children.push(node);
      }
    }
  }

  return c.json(root);
}) as any);

// POST /:id/disconnect — disconnect from parent
accountRoutes.openapi(disconnectAccountRoute, (async (c: any) => {
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

    const txDescendants = await tx.query.accounts.findMany({
      where: and(like(accounts.path, `${oldPath}.%`), isNull(accounts.deletedAt)),
      limit: 1000,
    });

    for (const d of txDescendants) {
      const descPath = d.path ?? '';
      const newDescPath = descPath.replace(oldPath, newSlug);
      const newDepth = newDescPath.split('.').length - 1;

      await tx
        .update(accounts)
        .set({
          path: newDescPath,
          depth: newDepth,
          updatedAt: new Date(),
        })
        .where(eq(accounts.id, d.id));
    }
  });

  return c.json({ message: 'Successfully disconnected from parent account' });
}) as any);

// POST /:id/release/:childId — parent releases a child account
accountRoutes.openapi(releaseChildRoute, (async (c: any) => {
  const account = c.get('account');
  if (!account) return c.json({ error: 'Account not found' }, 404);

  const { childId } = c.req.valid('param');
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

    const txDescendants = await tx.query.accounts.findMany({
      where: and(like(accounts.path, `${oldPath}.%`), isNull(accounts.deletedAt)),
      limit: 1000,
    });

    for (const d of txDescendants) {
      const descPath = d.path ?? '';
      const newDescPath = descPath.replace(oldPath, newSlug);
      const newDepth = newDescPath.split('.').length - 1;
      await tx
        .update(accounts)
        .set({ path: newDescPath, depth: newDepth, updatedAt: new Date() })
        .where(eq(accounts.id, d.id));
    }
  });

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.ACCOUNT_CHILD_RELEASED,
    description: `Released child account '${child.name ?? child.slug}' from parent '${account.name}'`,
    resourceType: 'account',
    resourceId: child.id,
    resourceName: child.name ?? child.slug ?? undefined,
    details: { parentAccountId: account.id, parentAccountName: account.name },
  });

  return c.json({ message: 'Child account released successfully' });
}) as any);

// POST /:id/impersonate — super user enters account's panel
accountRoutes.openapi(impersonateAccountRoute, (async (c: any) => {
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
    accountId: account.id,
    name: account.name,
    slug: account.slug,
  });
}) as any);

// GET /:id/members — list members of the account
accountRoutes.openapi(listMembersRoute, (async (c: any) => {
  const account = c.get('account');
  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const memberships = await db.query.userAccounts.findMany({
    where: eq(userAccounts.accountId, account.id),
    with: { user: true },
    limit: 500,
  });

  const members = memberships.map((m: any) => ({
    id: m.user.id,
    email: m.user.email,
    name: m.user.name,
    avatarUrl: m.user.avatarUrl,
    role: m.role,
    joinedAt: m.createdAt,
  }));

  return c.json(members);
}) as any);

// POST /:id/members — invite user to account
accountRoutes.openapi(inviteMemberRoute, (async (c: any) => {
  const account = c.get('account');
  const authUser = c.get('user');

  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  let inviterRole: string = 'owner'; // Super users treated as owner
  if (!authUser.isSuper) {
    const inviterMembership = await db.query.userAccounts.findFirst({
      where: (ua: any, { and, eq: e }: any) =>
        and(e(ua.userId, authUser.userId), e(ua.accountId, account.id)),
    });

    if (!inviterMembership || (inviterMembership.role !== 'owner' && inviterMembership.role !== 'admin')) {
      return c.json({ error: 'Only owners and admins can invite members' }, 403);
    }
    inviterRole = inviterMembership.role ?? 'member';
  }

  const { email, role } = c.req.valid('json');

  // Prevent role escalation: admins cannot invite at admin level (only owners can)
  const ROLE_LEVELS: Record<string, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
  if ((ROLE_LEVELS[role] ?? 0) >= (ROLE_LEVELS[inviterRole] ?? 0)) {
    return c.json({ error: 'Cannot invite at a role equal to or higher than your own' }, 403);
  }

  // Enforce max users per account from billing plan
  const accountSub = await db.query.subscriptions.findFirst({
    where: (s: any, { and, eq: e }: any) => and(e(s.accountId, account.id), e(s.status, 'active')),
    with: { plan: true },
  });
  const maxUsers = (accountSub as any)?.plan?.maxUsersPerAccount;
  if (maxUsers && maxUsers > 0) {
    const memberCount = await db.select({ count: countSql() })
      .from(userAccounts)
      .where(eq(userAccounts.accountId, account.id));
    const currentCount = Number(memberCount[0]?.count ?? 0);
    if (currentCount >= maxUsers) {
      return c.json({
        error: `Account has reached the maximum of ${maxUsers} members for your plan. Upgrade to add more.`
      }, 403);
    }
  }

  const targetUser = await db.query.users.findFirst({
    where: and(eq(users.email, email), isNull(users.deletedAt)),
  });

  if (!targetUser) {
    return c.json({ error: 'User with this email not found. They must register first.' }, 404);
  }

  const existingMembership = await db.query.userAccounts.findFirst({
    where: (ua: any, { and, eq: e }: any) =>
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
  const appUrl = await getAppUrl();
  queueEmail({
    templateSlug: 'invite',
    to: targetUser.email!,
    variables: {
      userName: targetUser.name ?? targetUser.email ?? '',
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
}) as any);

// PATCH /:id/members/:userId — change member role
accountRoutes.openapi(changeMemberRoleRoute, (async (c: any) => {
  const account = c.get('account');
  const authUser = c.get('user');
  const { userId: targetUserId } = c.req.valid('param');

  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  const { role } = c.req.valid('json');

  if (!authUser.isSuper) {
    const authMembership = await db.query.userAccounts.findFirst({
      where: (ua: any, { and, eq: e }: any) =>
        and(e(ua.userId, authUser.userId), e(ua.accountId, account.id)),
    });

    if (!authMembership || authMembership.role !== 'owner') {
      return c.json({ error: 'Only account owners can change member roles' }, 403);
    }
  }

  const [updated] = await updateReturning(userAccounts, { role },
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
    description: `Changed role to ${role}`,
    resourceType: 'user',
    resourceId: targetUserId,
  });

  return c.json({ message: 'Role updated', role });
}) as any);

// DELETE /:id/members/:userId — remove member from account
accountRoutes.openapi(removeMemberRoute, (async (c: any) => {
  const account = c.get('account');
  const authUser = c.get('user');
  const { userId: targetUserId } = c.req.valid('param');

  if (!account) {
    return c.json({ error: 'Account not found' }, 404);
  }

  if (targetUserId === authUser.userId) {
    const owners = await db.query.userAccounts.findMany({
      where: (ua: any, { and, eq: e }: any) =>
        and(e(ua.accountId, account.id), e(ua.role, 'owner')),
    });

    if (owners.length <= 1) {
      return c.json({ error: 'Cannot remove the last owner of an account' }, 400);
    }
  }

  if (!authUser.isSuper && targetUserId !== authUser.userId) {
    const ROLE_LEVELS: Record<string, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

    const authMembership = await db.query.userAccounts.findFirst({
      where: (ua: any, { and, eq: e }: any) =>
        and(e(ua.userId, authUser.userId), e(ua.accountId, account.id)),
    });

    if (!authMembership || (authMembership.role !== 'owner' && authMembership.role !== 'admin')) {
      return c.json({ error: 'Only owners and admins can remove members' }, 403);
    }

    // Check target role — can only remove members below your own role level
    const targetMembership = await db.query.userAccounts.findFirst({
      where: (ua: any, { and, eq: e }: any) =>
        and(e(ua.userId, targetUserId), e(ua.accountId, account.id)),
    });

    if (targetMembership && (ROLE_LEVELS[targetMembership.role ?? 'member'] ?? 0) >= (ROLE_LEVELS[authMembership.role ?? 'member'] ?? 0)) {
      return c.json({ error: 'Cannot remove a member with a role equal to or higher than your own' }, 403);
    }
  }

  // Prevent removing the last owner (even for self-removal, already checked above, but also for super admins)
  if (targetUserId !== authUser.userId) {
    const targetMembership = await db.query.userAccounts.findFirst({
      where: (ua: any, { and, eq: e }: any) =>
        and(e(ua.userId, targetUserId), e(ua.accountId, account.id)),
    });

    if (targetMembership?.role === 'owner') {
      const owners = await db.query.userAccounts.findMany({
        where: (ua: any, { and, eq: e }: any) =>
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
}) as any);

// GET /:id/my-role — get current user's role in this account
accountRoutes.openapi(getMyRoleRoute, (async (c: any) => {
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
}) as any);

// GET /:id/activity — account-scoped audit log with filtering
accountRoutes.openapi(getActivityRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: paramId } = c.req.valid('param');

  if (!accountId || accountId !== paramId) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const query = c.req.valid('query');
  const page = Math.max(1, Math.min(parseInt(query.page ?? '1', 10) || 1, 10000));
  const limit = Math.min(Math.max(1, parseInt(query.limit ?? '20', 10) || 20), 100);
  const offset = (page - 1) * limit;

  const resourceType = query.resourceType;
  const eventType = query.eventType;
  const dateFrom = query.dateFrom;
  const dateTo = query.dateTo;
  const search = query.search;

  const conditions: any[] = [eq(auditLog.accountId, accountId)];
  if (resourceType) conditions.push(eq(auditLog.resourceType, resourceType));
  if (eventType) {
    const sanitizedType = eventType.replace(/%/g, '\\%').replace(/_/g, '\\_');
    conditions.push(like(auditLog.eventType, `${sanitizedType}%`));
  }
  if (dateFrom) conditions.push(gte(auditLog.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(auditLog.createdAt, new Date(dateTo)));
  if (search) {
    const sanitized = search.replace(/%/g, '\\%').replace(/_/g, '\\_');
    conditions.push(
      or(
        like(auditLog.description, `%${sanitized}%`),
        like(auditLog.actorEmail, `%${sanitized}%`),
        like(auditLog.resourceName, `%${sanitized}%`),
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
}) as any);

// POST /:id/sub-accounts — create a sub-account with billing plan
accountRoutes.openapi(createSubAccountRoute, (async (c: any) => {
  const user = c.get('user');
  const parentAccount = c.get('account');
  if (!parentAccount) {
    return c.json({ error: 'Parent account not found' }, 404);
  }

  const parentId = parentAccount.id;
  const data = c.req.valid('json');
  const { name, planId, billingCycle, inheritBilling, successUrl, cancelUrl } = data;

  // Verify user is owner or admin on the parent account
  if (!user.isSuper) {
    const membership = await db.query.userAccounts.findFirst({
      where: (ua: any, { and, eq: e }: any) =>
        and(e(ua.userId, user.userId), e(ua.accountId, parentId)),
    });
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return c.json({ error: 'You must be an owner or admin to create sub-accounts' }, 403);
    }
  }

  // Look up the parent's full record for path/depth/billing
  const parent = await db.query.accounts.findFirst({
    where: and(eq(accounts.id, parentId), isNull(accounts.deletedAt)),
  });
  if (!parent) {
    return c.json({ error: 'Parent account not found' }, 404);
  }

  // Create the sub-account
  const parentPath = parent.path ?? parent.slug ?? '';
  const depth = (parent.depth ?? 0) + 1;
  const childSlug = slugify(name) + '-' + Date.now().toString(36);
  const childPath = parentPath ? `${parentPath}.${childSlug}` : childSlug;

  const existingSlug = await db.query.accounts.findFirst({
    where: and(eq(accounts.slug, childSlug), isNull(accounts.deletedAt)),
  });
  if (existingSlug) {
    return c.json({ error: 'Account slug already exists' }, 409);
  }

  // No plan selected — just create the account without a subscription
  if (!planId) {
    let account: any;
    await safeTransaction(async (tx) => {
      [account] = await tx.insert(accounts).values({
        name,
        slug: childSlug,
        parentId,
        path: childPath,
        depth,
        status: 'active',
      }).returning();

      if (!account) throw new Error('Failed to create account');

      await tx.insert(userAccounts).values({
        userId: user.userId,
        accountId: account.id,
        role: 'owner',
      });
    });

    eventService.log({
      ...eventContext(c),
      eventType: EventTypes.ACCOUNT_CREATED,
      description: `Created sub-account '${name}'`,
      resourceType: 'account',
      resourceId: account.id,
      resourceName: name,
    });

    return c.json({ account }, 201);
  }

  // Plan-based flow — look up the selected plan
  const plan = await db.query.billingPlans.findFirst({
    where: eq(billingPlans.id, planId),
  });
  if (!plan) {
    return c.json({ error: 'Plan not found' }, 404);
  }

  const effectiveCycle = billingCycle ?? 'monthly';
  const effectiveInherit = inheritBilling ?? true;

  // Validate billing cycle against config
  const bConfig = await db.query.billingConfig.findFirst();
  const allowedCycles = (bConfig?.allowedCycles ?? ['monthly', 'yearly']) as string[];
  if (!allowedCycles.includes(effectiveCycle)) {
    return c.json({ error: 'Invalid billing cycle' }, 400);
  }

  // If inherit billing, verify parent has an active subscription with stripeCustomerId
  if (effectiveInherit && !plan.isFree) {
    if (!parent.stripeCustomerId) {
      return c.json({ error: 'Parent account has no payment method on file. Set up billing on the parent account first.' }, 400);
    }
    const parentSub = await db.query.subscriptions.findFirst({
      where: and(eq(subscriptions.accountId, parentId), eq(subscriptions.status, 'active')),
    });
    if (!parentSub) {
      return c.json({ error: 'Parent account has no active subscription. Set up billing on the parent account first.' }, 400);
    }
  }

  // If own billing for a paid plan, require redirect URLs
  if (!effectiveInherit && !plan.isFree) {
    if (!successUrl || !cancelUrl) {
      return c.json({ error: 'successUrl and cancelUrl are required for paid plans with own billing' }, 400);
    }
  }

  let account: any;
  let subscription: any;

  if (effectiveInherit) {
    // Parent pays for child
    await safeTransaction(async (tx) => {
      [account] = await tx.insert(accounts).values({
        name,
        slug: childSlug,
        parentId,
        path: childPath,
        depth,
        stripeCustomerId: plan.isFree ? null : parent.stripeCustomerId,
        status: 'active',
      }).returning();

      if (!account) throw new Error('Failed to create account');

      await tx.insert(userAccounts).values({
        userId: user.userId,
        accountId: account.id,
        role: 'owner',
      });

      // Create subscription directly
      if (plan.isFree) {
        [subscription] = await tx.insert(subscriptions).values({
          accountId: account.id,
          planId,
          billingModel: 'fixed',
          billingCycle: effectiveCycle,
          status: 'active',
        }).returning();
      } else {
        // Get Stripe price ID for the cycle
        const priceIds = (plan.stripePriceIds ?? {}) as Record<string, string>;
        const priceId = priceIds[effectiveCycle];
        if (!priceId) {
          throw new Error(`No Stripe price configured for ${effectiveCycle} cycle`);
        }

        // Create Stripe subscription on parent's customer
        const { stripeService } = await import('../services/stripe.service.js');
        const stripeSub = await stripeService.createDirectSubscription({
          customerId: parent.stripeCustomerId!,
          priceId,
          metadata: {
            accountId: account.id,
            billedByAccountId: parentId,
            billingModel: 'fixed',
            billingCycle: effectiveCycle,
            planId,
          },
        });

        [subscription] = await tx.insert(subscriptions).values({
          accountId: account.id,
          planId,
          billingModel: 'fixed',
          billingCycle: effectiveCycle,
          stripeSubscriptionId: stripeSub.id,
          stripeCustomerId: parent.stripeCustomerId,
          billedByAccountId: parentId,
          status: stripeSub.status === 'active' ? 'active' : 'incomplete',
        }).returning();
      }
    });

    eventService.log({
      ...eventContext(c),
      eventType: EventTypes.ACCOUNT_CREATED,
      description: `Created sub-account '${name}' with billing inherited from parent`,
      resourceType: 'account',
      resourceId: account.id,
      resourceName: name,
    });

    return c.json({ account, subscription }, 201);
  }

  // Own billing
  await safeTransaction(async (tx) => {
    [account] = await tx.insert(accounts).values({
      name,
      slug: childSlug,
      parentId,
      path: childPath,
      depth,
      status: 'active',
    }).returning();

    if (!account) throw new Error('Failed to create account');

    await tx.insert(userAccounts).values({
      userId: user.userId,
      accountId: account.id,
      role: 'owner',
    });

    if (plan.isFree) {
      [subscription] = await tx.insert(subscriptions).values({
        accountId: account.id,
        planId,
        billingModel: 'fixed',
        billingCycle: effectiveCycle,
        status: 'active',
      }).returning();
    }
  });

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.ACCOUNT_CREATED,
    description: `Created sub-account '${name}'`,
    resourceType: 'account',
    resourceId: account.id,
    resourceName: name,
  });

  // For free plans, we're done
  if (plan.isFree) {
    return c.json({ account, subscription }, 201);
  }

  // For paid plans with own billing, create a checkout session
  const { stripeService } = await import('../services/stripe.service.js');
  const { stripeSyncService } = await import('../services/stripe-sync.service.js');

  // Create Stripe customer for the child account
  let childStripeCustomerId = account.stripeCustomerId;
  if (!childStripeCustomerId) {
    const customer = await stripeService.createCustomer(user.email, account.name ?? user.email);
    childStripeCustomerId = customer.id;
    await db.update(accounts).set({ stripeCustomerId: childStripeCustomerId, updatedAt: new Date() }).where(eq(accounts.id, account.id));
  }

  const result = await stripeSyncService.createCheckoutSession({
    accountId: account.id,
    billingModel: 'fixed',
    billingCycle: effectiveCycle,
    planId,
    stripeCustomerId: childStripeCustomerId,
    successUrl: successUrl!,
    cancelUrl: cancelUrl!,
  });

  return c.json({ account, checkoutUrl: result.url }, 201);
}) as any);

// ── Account-scoped log archives ──

accountRoutes.get('/:id/archives', authMiddleware, tenantMiddleware, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: paramId } = c.req.param();

  if (!accountId || accountId !== paramId) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10) || 1);
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50), 100);
  const offset = (page - 1) * limit;

  const archives = await db
    .select()
    .from(logArchives)
    .where(and(eq(logArchives.accountId, accountId), eq(logArchives.logType, 'audit')))
    .orderBy(desc(logArchives.createdAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: countSql() })
    .from(logArchives)
    .where(and(eq(logArchives.accountId, accountId), eq(logArchives.logType, 'audit')));

  return c.json({
    data: archives,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  });
}) as any);

accountRoutes.get('/:id/archives/:archiveId/download', authMiddleware, tenantMiddleware, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: paramId, archiveId } = c.req.param();

  if (!accountId || accountId !== paramId) {
    return c.json({ error: 'Access denied' }, 403);
  }

  const archive = await db.query.logArchives.findFirst({
    where: and(eq(logArchives.id, archiveId), eq(logArchives.accountId, accountId)),
  });

  if (!archive) {
    return c.json({ error: 'Archive not found' }, 404);
  }

  try {
    const { stat: fsStat } = await import('node:fs/promises');
    const { createReadStream } = await import('node:fs');
    const fileStat = await fsStat(archive.filePath);
    c.header('Content-Type', 'application/gzip');
    c.header('Content-Disposition', `attachment; filename="${archive.filename}"`);
    c.header('Content-Length', String(fileStat.size));
    const stream = createReadStream(archive.filePath);
    return c.body(stream);
  } catch {
    return c.json({ error: 'Archive file not found on disk' }, 404);
  }
}) as any);

accountRoutes.delete('/:id/archives/:archiveId', authMiddleware, tenantMiddleware, requireOwner, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: paramId, archiveId } = c.req.param();

  if (!accountId || accountId !== paramId) {
    return c.json({ error: 'Access denied' }, 403);
  }

  // Check if user archive deletion is allowed
  const allowSetting = await db.query.platformSettings.findFirst({
    where: eq(platformSettings.key, 'platform:logArchive:allowUserArchiveDelete'),
  });
  const allowed = allowSetting?.value === true;
  const user = c.get('user');

  if (!allowed && !user?.isSuper) {
    return c.json({ error: 'Archive deletion is not permitted' }, 403);
  }

  const archive = await db.query.logArchives.findFirst({
    where: and(eq(logArchives.id, archiveId), eq(logArchives.accountId, accountId)),
  });

  if (!archive) {
    return c.json({ error: 'Archive not found' }, 404);
  }

  try {
    const { unlink } = await import('node:fs/promises');
    await unlink(archive.filePath);
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      return c.json({ error: 'Failed to delete archive file' }, 500);
    }
  }

  await db.delete(logArchives).where(eq(logArchives.id, archiveId));
  return c.json({ success: true });
}) as any);

export default accountRoutes;
