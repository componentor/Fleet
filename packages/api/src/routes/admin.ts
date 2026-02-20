import { Hono } from 'hono';
import { db, accounts, users, services, nodes, deployments, auditLog, errorLog, updateReturning, countSql, eq, and, or, like, isNull, desc, gte, lte } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { dockerService } from '../services/docker.service.js';
import { updateService } from '../services/update.service.js';
import { getValkey } from '../services/valkey.service.js';
import { isQueueAvailable, getDeploymentQueue, getBackupQueue, getMaintenanceQueue } from '../services/queue.service.js';
import { logger } from '../services/logger.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';

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
    .from(accounts)
    .where(isNull(accounts.deletedAt));

  const [userCount] = await db
    .select({ count: countSql() })
    .from(users)
    .where(isNull(users.deletedAt));

  const [serviceCount] = await db
    .select({ count: countSql() })
    .from(services)
    .where(isNull(services.deletedAt));

  const [nodeCount] = await db
    .select({ count: countSql() })
    .from(nodes);

  const [runningServices] = await db
    .select({ count: countSql() })
    .from(services)
    .where(and(eq(services.status, 'running'), isNull(services.deletedAt)));

  // Error/issue counts for dashboard
  const [unresolvedErrors] = await db
    .select({ count: countSql() })
    .from(errorLog)
    .where(eq(errorLog.resolved, false));

  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [recentErrors] = await db
    .select({ count: countSql() })
    .from(errorLog)
    .where(gte(errorLog.createdAt, oneDayAgo));

  const [fatalErrors] = await db
    .select({ count: countSql() })
    .from(errorLog)
    .where(and(eq(errorLog.level, 'fatal'), eq(errorLog.resolved, false)));

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
    errors: {
      unresolved: unresolvedErrors?.count ?? 0,
      last24h: recentErrors?.count ?? 0,
      fatal: fatalErrors?.count ?? 0,
    },
    swarm: swarmInfo
      ? {
          id: swarmInfo.ID,
          createdAt: swarmInfo.CreatedAt,
          version: swarmInfo.Version,
        }
      : null,
    updateAvailable: updateService.getNotification().available
      ? `Fleet ${updateService.getNotification().latest?.tag ?? 'update'} is available`
      : null,
  });
});

// GET /accounts — list all accounts (paginated)
adminRoutes.get('/accounts', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)));
  const offset = (page - 1) * limit;

  const allAccounts = await db.query.accounts.findMany({
    where: isNull(accounts.deletedAt),
    orderBy: (a, { asc }) => asc(a.path),
    limit,
    offset,
  });

  const [total] = await db
    .select({ count: countSql() })
    .from(accounts)
    .where(isNull(accounts.deletedAt));

  // Strip sensitive billing fields from response
  const sanitizedAccounts = allAccounts.map(({ ...acc }) => {
    const a = acc as Record<string, unknown>;
    delete a['stripeCustomerId'];
    return a;
  });

  return c.json({
    data: sanitizedAccounts,
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
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)));
  const offset = (page - 1) * limit;

  const allUsers = await db.query.users.findMany({
    where: isNull(users.deletedAt),
    orderBy: (u, { desc: d }) => d(u.createdAt),
    limit,
    offset,
  });

  const [total] = await db
    .select({ count: countSql() })
    .from(users)
    .where(isNull(users.deletedAt));

  // Only expose safe fields — never return tokens, secrets, or hashes
  const sanitized = allUsers.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    isSuper: u.isSuper,
    emailVerified: u.emailVerified,
    twoFactorEnabled: u.twoFactorEnabled,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  }));

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
    where: and(eq(users.id, targetUserId), isNull(users.deletedAt)),
  });

  if (!targetUser) {
    return c.json({ error: 'User not found' }, 404);
  }

  const [updated] = await updateReturning(users, { isSuper: !targetUser.isSuper, securityChangedAt: new Date(), updatedAt: new Date() }, eq(users.id, targetUserId));

  logger.info({ targetUserId, newIsSuper: !targetUser.isSuper, changedBy: authUser.userId }, 'Super user status toggled');

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.USER_SUPER_TOGGLED,
    description: `Set super admin to ${!targetUser.isSuper} for ${targetUser.email}`,
    resourceType: 'user',
    resourceId: targetUserId,
    resourceName: targetUser.email ?? undefined,
  });

  return c.json({
    id: updated!.id,
    email: updated!.email,
    name: updated!.name,
    isSuper: updated!.isSuper,
  });
});

// GET /audit-log — platform-wide audit log with filtering
adminRoutes.get('/audit-log', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)));
  const offset = (page - 1) * limit;

  const resourceType = c.req.query('resourceType');
  const eventType = c.req.query('eventType');
  const userId = c.req.query('userId');
  const accountId = c.req.query('accountId');
  const dateFrom = c.req.query('dateFrom');
  const dateTo = c.req.query('dateTo');
  const search = c.req.query('search');

  const conditions: any[] = [];
  if (resourceType) conditions.push(eq(auditLog.resourceType, resourceType));
  if (eventType) {
    const sanitizedType = eventType.replace(/%/g, '\\%').replace(/_/g, '\\_');
    conditions.push(like(auditLog.eventType, `${sanitizedType}%`));
  }
  if (userId) conditions.push(eq(auditLog.userId, userId));
  if (accountId) conditions.push(eq(auditLog.accountId, accountId));
  if (dateFrom) conditions.push(gte(auditLog.createdAt, new Date(dateFrom)));
  if (dateTo) conditions.push(lte(auditLog.createdAt, new Date(dateTo)));
  if (search) {
    // Escape SQL LIKE wildcards to prevent search injection
    const sanitized = search.replace(/%/g, '\\%').replace(/_/g, '\\_');
    conditions.push(
      or(
        like(auditLog.description, `%${sanitized}%`),
        like(auditLog.actorEmail, `%${sanitized}%`),
        like(auditLog.resourceName, `%${sanitized}%`),
        like(auditLog.action, `%${sanitized}%`),
      )
    );
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

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

// GET /services — list all services across all accounts
adminRoutes.get('/services', async (c) => {
  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') ?? '50', 10)));
  const offset = (page - 1) * limit;

  const allServices = await db.query.services.findMany({
    where: isNull(services.deletedAt),
    with: { account: true },
    orderBy: (s, { desc: d }) => d(s.createdAt),
    limit,
    offset,
  });

  const [total] = await db
    .select({ count: countSql() })
    .from(services)
    .where(isNull(services.deletedAt));

  // Strip env vars from admin listing to avoid leaking secrets
  const sanitizedServices = allServices.map(({ ...svc }) => {
    const s = svc as Record<string, unknown>;
    delete s['env'];
    return s;
  });

  return c.json({
    data: sanitizedServices,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  });
});

// GET /status — system health & status overview
adminRoutes.get('/status', async (c) => {
  const startTime = Date.now();

  // --- Valkey ---
  let valkeyStatus: 'connected' | 'disconnected' = 'disconnected';
  let valkeyLatencyMs: number | null = null;
  let valkeyMemory: string | null = null;
  try {
    const valkey = await getValkey();
    if (valkey) {
      const t0 = Date.now();
      await valkey.ping();
      valkeyLatencyMs = Date.now() - t0;
      valkeyStatus = 'connected';

      const info = await valkey.info('memory');
      const usedMatch = info.match(/used_memory_human:(\S+)/);
      valkeyMemory = usedMatch?.[1] ?? null;
    }
  } catch {}

  // --- Queue stats (BullMQ) ---
  let queues: Array<{ name: string; waiting: number; active: number; completed: number; failed: number; delayed: number }> | null = null;
  if (isQueueAvailable()) {
    try {
      const [depQ, backQ, maintQ] = await Promise.all([
        getDeploymentQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
        getBackupQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
        getMaintenanceQueue().getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      ]);
      const mapCounts = (name: string, q: Record<string, number>) => ({
        name,
        waiting: q['waiting'] ?? 0,
        active: q['active'] ?? 0,
        completed: q['completed'] ?? 0,
        failed: q['failed'] ?? 0,
        delayed: q['delayed'] ?? 0,
      });
      queues = [
        mapCounts('deployment', depQ),
        mapCounts('backup', backQ),
        mapCounts('maintenance', maintQ),
      ];
    } catch {}
  }

  // --- Docker Swarm ---
  let docker: { status: string; nodes: number; managers: number; workers: number } | null = null;
  try {
    const swarm = await dockerService.getSwarmInfo();
    const dockerNodes = await dockerService.listNodes();
    const managers = dockerNodes.filter((n: any) => n.Spec?.Role === 'manager').length;
    docker = {
      status: 'connected',
      nodes: dockerNodes.length,
      managers,
      workers: dockerNodes.length - managers,
    };
  } catch {
    docker = { status: 'disconnected', nodes: 0, managers: 0, workers: 0 };
  }

  // --- Nodes from DB (paginated) ---
  const nodesPage = Math.max(1, parseInt(c.req.query('nodesPage') ?? '1', 10));
  const nodesLimit = Math.min(100, Math.max(1, parseInt(c.req.query('nodesLimit') ?? '100', 10)));
  const nodesOffset = (nodesPage - 1) * nodesLimit;
  const allNodes = await db.query.nodes.findMany({ limit: nodesLimit, offset: nodesOffset });
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
  const nodeStatuses = allNodes.map((n) => ({
    id: n.id,
    hostname: n.hostname,
    ipAddress: n.ipAddress,
    role: n.role,
    status: n.status,
    healthy: !!n.lastHeartbeat && new Date(n.lastHeartbeat) > fiveMinAgo,
    lastHeartbeat: n.lastHeartbeat,
  }));

  // --- Services breakdown (use counts instead of loading all records) ---
  const statusPage = Math.max(1, parseInt(c.req.query('servicesPage') ?? '1', 10));
  const statusLimit = Math.min(100, Math.max(1, parseInt(c.req.query('servicesLimit') ?? '100', 10)));
  const statusOffset = (statusPage - 1) * statusLimit;
  const allServices = await db.query.services.findMany({ where: isNull(services.deletedAt), limit: statusLimit, offset: statusOffset });
  const servicesByStatus: Record<string, number> = {};
  for (const s of allServices) {
    const st = s.status ?? 'unknown';
    servicesByStatus[st] = (servicesByStatus[st] ?? 0) + 1;
  }

  // --- Recent deployments ---
  const recentDeploys = await db.query.deployments.findMany({
    orderBy: (d, { desc: descOrder }) => descOrder(d.createdAt),
    limit: 10,
    with: { service: true },
  });

  const recentDeployments = recentDeploys.map((d) => ({
    id: d.id,
    serviceName: d.service?.name ?? 'unknown',
    status: d.status,
    commitSha: d.commitSha,
    createdAt: d.createdAt,
  }));

  // --- API uptime ---
  const uptimeSeconds = Math.floor(process.uptime());

  return c.json({
    timestamp: new Date().toISOString(),
    responseTimeMs: Date.now() - startTime,
    api: {
      status: 'healthy',
      uptimeSeconds,
      nodeVersion: process.version,
      memoryUsageMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    },
    valkey: {
      status: valkeyStatus,
      latencyMs: valkeyLatencyMs,
      memoryUsage: valkeyMemory,
    },
    queues: {
      available: isQueueAvailable(),
      data: queues,
    },
    docker,
    nodes: nodeStatuses,
    services: {
      total: allServices.length,
      byStatus: servicesByStatus,
    },
    recentDeployments,
  });
});

export default adminRoutes;
