import { Hono } from 'hono';
import { db, accounts, users, services, nodes, deployments, auditLog, updateReturning, countSql, eq, and } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { dockerService } from '../services/docker.service.js';
import { updateService } from '../services/update.service.js';
import { getValkey } from '../services/valkey.service.js';
import { isQueueAvailable, getDeploymentQueue, getBackupQueue, getMaintenanceQueue } from '../services/queue.service.js';

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
    updateAvailable: updateService.getNotification().available
      ? `Fleet ${updateService.getNotification().latest?.tag ?? 'update'} is available`
      : null,
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

  // --- Nodes from DB ---
  const allNodes = await db.query.nodes.findMany({ limit: 1000 });
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

  // --- Services breakdown ---
  const allServices = await db.query.services.findMany({ limit: 1000 });
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
