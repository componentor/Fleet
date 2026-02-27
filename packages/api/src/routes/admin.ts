import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, accounts, users, services, nodes, deployments, auditLog, errorLog, statusPosts, statusPostTranslations, platformSettings, adminRoles, insertReturning, updateReturning, countSql, eq, and, or, like, isNull, desc, gte, lte } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { loadAdminPermissions, requireAdminPermission, requireSuperAdmin } from '../middleware/admin-permission.js';
import type { AdminPermissions } from '../middleware/admin-permission.js';
import { dockerService } from '../services/docker.service.js';
import { updateService } from '../services/update.service.js';
import { getValkey } from '../services/valkey.service.js';
import { isQueueAvailable, getDeploymentQueue, getBackupQueue, getMaintenanceQueue } from '../services/queue.service.js';
import { logger } from '../services/logger.js';
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

const adminRoutes = new OpenAPIHono<Env>();

adminRoutes.use('*', authMiddleware);

// Admin guard: allow super users AND users with an admin role
adminRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper && !user.adminRoleId) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  await next();
});

// Load admin permissions for role-based admins
adminRoutes.use('*', loadAdminPermissions);

// ── Schemas ──

const idParamSchema = z.object({
  id: z.string().openapi({ description: 'Resource ID' }),
});

const paginationQuerySchema = z.object({
  page: z.string().optional().openapi({ description: 'Page number (default 1)' }),
  limit: z.string().optional().openapi({ description: 'Items per page (default 50, max 100)' }),
});

const auditLogQuerySchema = z.object({
  page: z.string().optional().openapi({ description: 'Page number (default 1)' }),
  limit: z.string().optional().openapi({ description: 'Items per page (default 50, max 100)' }),
  resourceType: z.string().optional().openapi({ description: 'Filter by resource type' }),
  eventType: z.string().optional().openapi({ description: 'Filter by event type prefix' }),
  userId: z.string().optional().openapi({ description: 'Filter by user ID' }),
  accountId: z.string().optional().openapi({ description: 'Filter by account ID' }),
  dateFrom: z.string().optional().openapi({ description: 'Filter from date (ISO string)' }),
  dateTo: z.string().optional().openapi({ description: 'Filter to date (ISO string)' }),
  search: z.string().optional().openapi({ description: 'Search in description, email, resource name, action' }),
});

const statusQuerySchema = z.object({
  nodesPage: z.string().optional().openapi({ description: 'Page for nodes (default 1)' }),
  nodesLimit: z.string().optional().openapi({ description: 'Nodes per page (default 100, max 100)' }),
  servicesPage: z.string().optional().openapi({ description: 'Page for services (default 1)' }),
  servicesLimit: z.string().optional().openapi({ description: 'Services per page (default 100, max 100)' }),
});

// ── Routes ──

// GET /stats — platform-wide statistics
const statsRoute = createRoute({
  method: 'get',
  path: '/stats',
  tags: ['Admin'],
  summary: 'Get platform-wide statistics',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Platform statistics'),
    ...standardErrors,
  },
});

adminRoutes.openapi(statsRoute, (async (c: any) => {
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
    version: {
      current: updateService.getNotification().current,
      latest: updateService.getNotification().latest?.tag ?? null,
      updateAvailable: updateService.getNotification().available,
      checkedAt: updateService.getNotification().checkedAt,
    },
  });
}) as any);

// GET /accounts — list all accounts (paginated)
const listAccountsRoute = createRoute({
  method: 'get',
  path: '/accounts',
  tags: ['Admin'],
  summary: 'List all accounts (paginated)',
  security: bearerSecurity,
  request: {
    query: paginationQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Paginated accounts list'),
    ...standardErrors,
  },
});

adminRoutes.openapi(listAccountsRoute, (async (c: any) => {
  const query = c.req.valid('query');
  const page = Math.max(1, parseInt(query.page ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '50', 10)));
  const offset = (page - 1) * limit;

  const allAccounts = await db.query.accounts.findMany({
    where: isNull(accounts.deletedAt),
    orderBy: (a: any, { asc }: any) => asc(a.path),
    limit,
    offset,
  });

  const [total] = await db
    .select({ count: countSql() })
    .from(accounts)
    .where(isNull(accounts.deletedAt));

  // Strip sensitive billing fields from response
  const sanitizedAccounts = allAccounts.map(({ ...acc }: any) => {
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
}) as any);

// GET /users — list all users
const listUsersRoute = createRoute({
  method: 'get',
  path: '/users',
  tags: ['Admin'],
  summary: 'List all users (paginated)',
  security: bearerSecurity,
  request: {
    query: paginationQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Paginated users list'),
    ...standardErrors,
  },
});

adminRoutes.openapi(listUsersRoute, (async (c: any) => {
  const query = c.req.valid('query');
  const page = Math.max(1, parseInt(query.page ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '50', 10)));
  const offset = (page - 1) * limit;

  const allUsers = await db.query.users.findMany({
    where: isNull(users.deletedAt),
    orderBy: (u: any, { desc: d }: any) => d(u.createdAt),
    limit,
    offset,
  });

  const [total] = await db
    .select({ count: countSql() })
    .from(users)
    .where(isNull(users.deletedAt));

  // Only expose safe fields — never return tokens, secrets, or hashes
  const sanitized = allUsers.map((u: any) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    isSuper: u.isSuper,
    adminRoleId: u.adminRoleId ?? null,
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
}) as any);

// PATCH /users/:id/super — toggle super user status
const toggleSuperRoute = createRoute({
  method: 'patch',
  path: '/users/{id}/super',
  tags: ['Admin'],
  summary: 'Toggle super user status',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Updated user with new super status'),
    ...standardErrors,
  },
});

adminRoutes.openapi(toggleSuperRoute, (async (c: any) => {
  const { id: targetUserId } = c.req.valid('param');
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
}) as any);

// GET /audit-log — platform-wide audit log with filtering
const auditLogRoute = createRoute({
  method: 'get',
  path: '/audit-log',
  tags: ['Admin'],
  summary: 'List platform-wide audit log with filtering',
  security: bearerSecurity,
  request: {
    query: auditLogQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Paginated audit log entries'),
    ...standardErrors,
  },
});

adminRoutes.openapi(auditLogRoute, (async (c: any) => {
  const query = c.req.valid('query');
  const page = Math.max(1, parseInt(query.page ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '50', 10)));
  const offset = (page - 1) * limit;

  const resourceType = query.resourceType;
  const eventType = query.eventType;
  const userId = query.userId;
  const accountId = query.accountId;
  const dateFrom = query.dateFrom;
  const dateTo = query.dateTo;
  const search = query.search;

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
}) as any);

// GET /services — list all services across all accounts
const listServicesRoute = createRoute({
  method: 'get',
  path: '/services',
  tags: ['Admin'],
  summary: 'List all services across all accounts (paginated)',
  security: bearerSecurity,
  request: {
    query: paginationQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Paginated services list'),
    ...standardErrors,
  },
});

adminRoutes.openapi(listServicesRoute, (async (c: any) => {
  const query = c.req.valid('query');
  const page = Math.max(1, parseInt(query.page ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '50', 10)));
  const offset = (page - 1) * limit;

  const allServices = await db.query.services.findMany({
    where: isNull(services.deletedAt),
    with: { account: true },
    orderBy: (s: any, { desc: d }: any) => d(s.createdAt),
    limit,
    offset,
  });

  const [total] = await db
    .select({ count: countSql() })
    .from(services)
    .where(isNull(services.deletedAt));

  // Strip env vars from admin listing to avoid leaking secrets
  const sanitizedServices = allServices.map(({ ...svc }: any) => {
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
}) as any);

// GET /status — system health & status overview
const statusRoute = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Admin'],
  summary: 'Get system health and status overview',
  security: bearerSecurity,
  request: {
    query: statusQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'System health and status overview'),
    ...standardErrors,
  },
});

adminRoutes.openapi(statusRoute, (async (c: any) => {
  const query = c.req.valid('query');
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
  let dockerNodeList: any[] = [];
  try {
    const swarm = await dockerService.getSwarmInfo();
    dockerNodeList = await dockerService.listNodes();
    const managers = dockerNodeList.filter((n: any) => n.Spec?.Role === 'manager').length;
    docker = {
      status: 'connected',
      nodes: dockerNodeList.length,
      managers,
      workers: dockerNodeList.length - managers,
    };
  } catch {
    docker = { status: 'disconnected', nodes: 0, managers: 0, workers: 0 };
  }

  // Build a lookup from Docker node ID → Docker node info
  const dockerNodeMap = new Map<string, any>(
    dockerNodeList.map((n: any) => [n.ID as string, n]),
  );

  // --- Nodes from DB (paginated) ---
  const nodesPage = Math.max(1, parseInt(query.nodesPage ?? '1', 10));
  const nodesLimit = Math.min(100, Math.max(1, parseInt(query.nodesLimit ?? '100', 10)));
  const nodesOffset = (nodesPage - 1) * nodesLimit;
  const allNodes = await db.query.nodes.findMany({ limit: nodesLimit, offset: nodesOffset });
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
  const nodeStatuses = allNodes.map((n: any) => {
    const dockerNode = n.dockerNodeId ? dockerNodeMap.get(n.dockerNodeId) ?? null : null;
    const dockerState = dockerNode?.Status?.State as string | undefined; // "ready" | "down" | "disconnected"
    const heartbeatHealthy = !!n.lastHeartbeat && new Date(n.lastHeartbeat) > fiveMinAgo;
    // Node is healthy if Docker says "ready" OR heartbeat is recent
    const healthy = dockerState === 'ready' || heartbeatHealthy;
    // Derive effective status: prefer Docker Swarm state over stale DB status
    let effectiveStatus = n.status;
    if (dockerState === 'ready' && n.status === 'offline') {
      effectiveStatus = 'active';
    } else if ((dockerState === 'down' || dockerState === 'disconnected') && n.status === 'active') {
      effectiveStatus = 'offline';
    }
    return {
      id: n.id,
      hostname: n.hostname,
      ipAddress: n.ipAddress,
      role: n.role,
      status: effectiveStatus,
      healthy,
      lastHeartbeat: n.lastHeartbeat,
    };
  });

  // --- Services breakdown (use counts instead of loading all records) ---
  const statusPage = Math.max(1, parseInt(query.servicesPage ?? '1', 10));
  const statusLimit = Math.min(100, Math.max(1, parseInt(query.servicesLimit ?? '100', 10)));
  const statusOffset = (statusPage - 1) * statusLimit;
  const allServices = await db.query.services.findMany({ where: isNull(services.deletedAt), limit: statusLimit, offset: statusOffset });
  const servicesByStatus: Record<string, number> = {};
  for (const s of allServices) {
    const st = (s as any).status ?? 'unknown';
    servicesByStatus[st] = (servicesByStatus[st] ?? 0) + 1;
  }

  // --- Recent deployments ---
  const recentDeploys = await db.query.deployments.findMany({
    orderBy: (d: any, { desc: descOrder }: any) => descOrder(d.createdAt),
    limit: 10,
    with: { service: true },
  });

  const recentDeployments = recentDeploys.map((d: any) => ({
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
}) as any);

// ── Status Post Schemas ──

const statusPostQuerySchema = z.object({
  page: z.string().optional().openapi({ description: 'Page number (default 1)' }),
  limit: z.string().optional().openapi({ description: 'Items per page (default 20, max 50)' }),
  status: z.enum(['draft', 'published', 'archived']).optional().openapi({ description: 'Filter by status' }),
});

const createStatusPostSchema = z.object({
  icon: z.enum(['incident', 'maintenance', 'resolved', 'info', 'degraded', 'outage']),
  severity: z.enum(['info', 'warning', 'critical']),
  affectedServices: z.array(z.string()),
  status: z.enum(['draft', 'published']),
  locale: z.string().min(2).max(5),
  title: z.string().min(1).max(300),
  body: z.string().min(1),
});

const updateStatusPostSchema = z.object({
  icon: z.enum(['incident', 'maintenance', 'resolved', 'info', 'degraded', 'outage']).optional(),
  severity: z.enum(['info', 'warning', 'critical']).optional(),
  affectedServices: z.array(z.string()).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
});

const upsertTranslationSchema = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1),
});

const autoTranslateSchema = z.object({
  sourceLocale: z.string(),
  targetLocales: z.array(z.string()).optional(),
});

const statusPostIdParamSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Status post ID' }),
});

const translationParamSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Status post ID' }),
  locale: z.string().min(2).max(5).openapi({ description: 'Locale code' }),
});

// ── Status Post Routes ──

// GET /status-posts — list all status posts with translations (paginated)
const listStatusPostsRoute = createRoute({
  method: 'get',
  path: '/status-posts',
  tags: ['Admin', 'Status Posts'],
  summary: 'List all status posts with translations (paginated)',
  security: bearerSecurity,
  request: {
    query: statusPostQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Paginated status posts list'),
    ...standardErrors,
  },
});

adminRoutes.openapi(listStatusPostsRoute, (async (c: any) => {
  const query = c.req.valid('query');
  const page = Math.max(1, parseInt(query.page ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '20', 10)));
  const offset = (page - 1) * limit;

  const conditions: any[] = [];
  if (query.status) {
    conditions.push(eq(statusPosts.status, query.status));
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const posts = await db
    .select()
    .from(statusPosts)
    .where(whereClause)
    .orderBy(desc(statusPosts.createdAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: countSql() })
    .from(statusPosts)
    .where(whereClause);

  // Fetch translations for each post
  const postsWithTranslations = await Promise.all(
    posts.map(async (post) => {
      const translations = await db
        .select()
        .from(statusPostTranslations)
        .where(eq(statusPostTranslations.postId, post.id));
      return { ...post, translations };
    }),
  );

  return c.json({
    data: postsWithTranslations,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  });
}) as any);

// POST /status-posts — create a new status post with initial translation
const createStatusPostRoute = createRoute({
  method: 'post',
  path: '/status-posts',
  tags: ['Admin', 'Status Posts'],
  summary: 'Create a new status post with initial translation',
  security: bearerSecurity,
  request: {
    body: jsonBody(createStatusPostSchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Created status post with translation'),
    ...standardErrors,
  },
});

adminRoutes.openapi(createStatusPostRoute, (async (c: any) => {
  const body = c.req.valid('json');
  const user = c.get('user');

  const [post] = await insertReturning(statusPosts, {
    icon: body.icon,
    severity: body.severity,
    affectedServices: body.affectedServices,
    status: body.status,
    publishedAt: body.status === 'published' ? new Date() : null,
    createdBy: user.userId,
  });

  const [translation] = await insertReturning(statusPostTranslations, {
    postId: post!.id,
    locale: body.locale,
    title: body.title,
    body: body.body,
  });

  return c.json({ ...post, translations: [translation] }, 201);
}) as any);

// PATCH /status-posts/:id — update status post metadata
const updateStatusPostRoute = createRoute({
  method: 'patch',
  path: '/status-posts/{id}',
  tags: ['Admin', 'Status Posts'],
  summary: 'Update status post metadata',
  security: bearerSecurity,
  request: {
    params: statusPostIdParamSchema,
    body: jsonBody(updateStatusPostSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated status post'),
    ...standardErrors,
  },
});

adminRoutes.openapi(updateStatusPostRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const existing = await db.query.statusPosts.findFirst({
    where: eq(statusPosts.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Status post not found' }, 404);
  }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.icon !== undefined) updates.icon = body.icon;
  if (body.severity !== undefined) updates.severity = body.severity;
  if (body.affectedServices !== undefined) updates.affectedServices = body.affectedServices;
  if (body.status !== undefined) {
    updates.status = body.status;
    if (body.status === 'published' && !existing.publishedAt) {
      updates.publishedAt = new Date();
    }
  }

  const [updated] = await updateReturning(statusPosts, updates, eq(statusPosts.id, id));

  return c.json(updated);
}) as any);

// DELETE /status-posts/:id — hard delete a status post (cascades translations)
const deleteStatusPostRoute = createRoute({
  method: 'delete',
  path: '/status-posts/{id}',
  tags: ['Admin', 'Status Posts'],
  summary: 'Delete a status post',
  security: bearerSecurity,
  request: {
    params: statusPostIdParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Status post deleted'),
    ...standardErrors,
  },
});

adminRoutes.openapi(deleteStatusPostRoute, (async (c: any) => {
  const { id } = c.req.valid('param');

  const existing = await db.query.statusPosts.findFirst({
    where: eq(statusPosts.id, id),
  });

  if (!existing) {
    return c.json({ error: 'Status post not found' }, 404);
  }

  await db.delete(statusPosts).where(eq(statusPosts.id, id));

  return c.json({ message: 'Status post deleted' });
}) as any);

// PUT /status-posts/:id/translations/:locale — upsert a translation
const upsertTranslationRoute = createRoute({
  method: 'put',
  path: '/status-posts/{id}/translations/{locale}',
  tags: ['Admin', 'Status Posts'],
  summary: 'Upsert a translation for a status post',
  security: bearerSecurity,
  request: {
    params: translationParamSchema,
    body: jsonBody(upsertTranslationSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Upserted translation'),
    ...standardErrors,
  },
});

adminRoutes.openapi(upsertTranslationRoute, (async (c: any) => {
  const { id, locale } = c.req.valid('param');
  const body = c.req.valid('json');

  const post = await db.query.statusPosts.findFirst({
    where: eq(statusPosts.id, id),
  });

  if (!post) {
    return c.json({ error: 'Status post not found' }, 404);
  }

  const existing = await db.query.statusPostTranslations.findFirst({
    where: and(
      eq(statusPostTranslations.postId, id),
      eq(statusPostTranslations.locale, locale),
    ),
  });

  if (existing) {
    const [updated] = await updateReturning(
      statusPostTranslations,
      { title: body.title, body: body.body, updatedAt: new Date() },
      eq(statusPostTranslations.id, existing.id),
    );
    return c.json(updated);
  } else {
    const [created] = await insertReturning(statusPostTranslations, {
      postId: id,
      locale,
      title: body.title,
      body: body.body,
    });
    return c.json(created);
  }
}) as any);

// DELETE /status-posts/:id/translations/:locale — delete a specific translation
const deleteTranslationRoute = createRoute({
  method: 'delete',
  path: '/status-posts/{id}/translations/{locale}',
  tags: ['Admin', 'Status Posts'],
  summary: 'Delete a specific translation for a status post',
  security: bearerSecurity,
  request: {
    params: translationParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Translation deleted'),
    ...standardErrors,
  },
});

adminRoutes.openapi(deleteTranslationRoute, (async (c: any) => {
  const { id, locale } = c.req.valid('param');

  const existing = await db.query.statusPostTranslations.findFirst({
    where: and(
      eq(statusPostTranslations.postId, id),
      eq(statusPostTranslations.locale, locale),
    ),
  });

  if (!existing) {
    return c.json({ error: 'Translation not found' }, 404);
  }

  await db.delete(statusPostTranslations).where(eq(statusPostTranslations.id, existing.id));

  return c.json({ message: 'Translation deleted' });
}) as any);

// POST /status-posts/:id/auto-translate — auto-translate using DeepL API
const autoTranslateRoute = createRoute({
  method: 'post',
  path: '/status-posts/{id}/auto-translate',
  tags: ['Admin', 'Status Posts'],
  summary: 'Auto-translate a status post using DeepL',
  security: bearerSecurity,
  request: {
    params: statusPostIdParamSchema,
    body: jsonBody(autoTranslateSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Translation results'),
    ...standardErrors,
  },
});

adminRoutes.openapi(autoTranslateRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  // Resolve DeepL API key from env or platform settings
  let deeplApiKey = process.env.DEEPL_API_KEY;
  if (!deeplApiKey) {
    const setting = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, 'translation:deepl_api_key'),
    });
    if (setting) {
      deeplApiKey = typeof setting.value === 'string' ? setting.value : (setting.value as any)?.key;
    }
  }

  if (!deeplApiKey) {
    return c.json({ error: 'Translation service not configured' }, 501);
  }

  // Fetch source translation
  const sourceTranslation = await db.query.statusPostTranslations.findFirst({
    where: and(
      eq(statusPostTranslations.postId, id),
      eq(statusPostTranslations.locale, body.sourceLocale),
    ),
  });

  if (!sourceTranslation) {
    return c.json({ error: 'Source translation not found' }, 404);
  }

  const supportedLocales = ['en', 'nb', 'de', 'zh'];
  const targetLocales = body.targetLocales ?? supportedLocales.filter((l) => l !== body.sourceLocale);

  const localeToDeepL: Record<string, string> = { en: 'EN', nb: 'NB', de: 'DE', zh: 'ZH' };
  const sourceDeepLLang = localeToDeepL[body.sourceLocale] ?? body.sourceLocale.toUpperCase();

  const translated: string[] = [];
  const failed: string[] = [];

  for (const targetLocale of targetLocales) {
    try {
      const targetDeepLLang = localeToDeepL[targetLocale] ?? targetLocale.toUpperCase();

      // Translate title
      const titleRes = await fetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${deeplApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: [sourceTranslation.title],
          target_lang: targetDeepLLang,
          source_lang: sourceDeepLLang,
        }),
      });

      if (!titleRes.ok) {
        failed.push(targetLocale);
        continue;
      }

      const titleData = await titleRes.json() as { translations: { text: string }[] };

      // Translate body
      const bodyRes = await fetch('https://api-free.deepl.com/v2/translate', {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${deeplApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: [sourceTranslation.body],
          target_lang: targetDeepLLang,
          source_lang: sourceDeepLLang,
        }),
      });

      if (!bodyRes.ok) {
        failed.push(targetLocale);
        continue;
      }

      const bodyData = await bodyRes.json() as { translations: { text: string }[] };

      const translatedTitle = titleData.translations[0]?.text ?? sourceTranslation.title;
      const translatedBody = bodyData.translations[0]?.text ?? sourceTranslation.body;

      // Upsert translation
      const existing = await db.query.statusPostTranslations.findFirst({
        where: and(
          eq(statusPostTranslations.postId, id),
          eq(statusPostTranslations.locale, targetLocale),
        ),
      });

      if (existing) {
        await updateReturning(
          statusPostTranslations,
          { title: translatedTitle, body: translatedBody, updatedAt: new Date() },
          eq(statusPostTranslations.id, existing.id),
        );
      } else {
        await insertReturning(statusPostTranslations, {
          postId: id,
          locale: targetLocale,
          title: translatedTitle,
          body: translatedBody,
        });
      }

      translated.push(targetLocale);
    } catch {
      failed.push(targetLocale);
    }
  }

  return c.json({ translated, failed });
}) as any);

export default adminRoutes;
