import { Hono } from 'hono';
import { db, accounts, users, services, nodes, auditLog, updateReturning, countSql, eq } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { dockerService } from '../services/docker.service.js';
import { updateService } from '../services/update.service.js';

const adminRoutes = new Hono<{
  Variables: { user: AuthUser };
}>();

adminRoutes.use('*', authMiddleware);

// Super user guard
adminRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super user access required' }, 403);
  }
  await next();
});

// GET /stats — platform-wide statistics
adminRoutes.get('/stats', async (c) => {
  const [accountCount] = await db
    .select({ count: countSql() })
    .from(accounts);

  const [userCount] = await db
    .select({ count: countSql() })
    .from(users);

  const [serviceCount] = await db
    .select({ count: countSql() })
    .from(services);

  const [nodeCount] = await db
    .select({ count: countSql() })
    .from(nodes);

  const [runningServices] = await db
    .select({ count: countSql() })
    .from(services)
    .where(eq(services.status, 'running'));

  let swarmInfo = null;
  try {
    swarmInfo = await dockerService.getSwarmInfo();
  } catch {
    // Docker may not be available
  }

  return c.json({
    accounts: accountCount?.count ?? 0,
    users: userCount?.count ?? 0,
    services: serviceCount?.count ?? 0,
    runningServices: runningServices?.count ?? 0,
    nodes: nodeCount?.count ?? 0,
    swarm: swarmInfo
      ? {
          id: swarmInfo.ID,
          createdAt: swarmInfo.CreatedAt,
          version: swarmInfo.Version,
        }
      : null,
    updateNotification: updateService.getNotification(),
  });
});

// GET /accounts — list all accounts (paginated)
adminRoutes.get('/accounts', async (c) => {
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const offset = (page - 1) * limit;

  const allAccounts = await db.query.accounts.findMany({
    orderBy: (a, { asc }) => asc(a.path),
    limit,
    offset,
  });

  const [total] = await db
    .select({ count: countSql() })
    .from(accounts);

  return c.json({
    data: allAccounts,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  });
});

// GET /users — list all users
adminRoutes.get('/users', async (c) => {
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const offset = (page - 1) * limit;

  const allUsers = await db.query.users.findMany({
    orderBy: (u, { desc: d }) => d(u.createdAt),
    limit,
    offset,
  });

  const [total] = await db
    .select({ count: countSql() })
    .from(users);

  // Don't expose password hashes
  const sanitized = allUsers.map(({ passwordHash, ...rest }) => rest);

  return c.json({
    data: sanitized,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  });
});

// PATCH /users/:id/super — toggle super user status
adminRoutes.patch('/users/:id/super', async (c) => {
  const targetUserId = c.req.param('id');
  const authUser = c.get('user');

  if (targetUserId === authUser.userId) {
    return c.json({ error: 'Cannot modify your own super user status' }, 400);
  }

  const targetUser = await db.query.users.findFirst({
    where: eq(users.id, targetUserId),
  });

  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404);
  }

  const [updated] = await updateReturning(users, { isSuper: !targetUser.isSuper, updatedAt: new Date() }, eq(users.id, targetUserId));

  return c.json({
    id: updated!.id,
    email: updated!.email,
    name: updated!.name,
    isSuper: updated!.isSuper,
  });
});

// GET /audit-log — platform-wide audit log
adminRoutes.get('/audit-log', async (c) => {
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const offset = (page - 1) * limit;

  const logs = await db.query.auditLog.findMany({
    orderBy: (a, { desc: d }) => d(a.createdAt),
    limit,
    offset,
  });

  const [total] = await db
    .select({ count: countSql() })
    .from(auditLog);

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

// GET /services — list all services across all accounts
adminRoutes.get('/services', async (c) => {
  const page = parseInt(c.req.query('page') ?? '1', 10);
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const offset = (page - 1) * limit;

  const allServices = await db.query.services.findMany({
    with: { account: true },
    orderBy: (s, { desc: d }) => d(s.createdAt),
    limit,
    offset,
  });

  const [total] = await db
    .select({ count: countSql() })
    .from(services);

  return c.json({
    data: allServices,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  });
});

export default adminRoutes;
