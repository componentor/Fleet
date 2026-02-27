import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, errorLog, selfHealingJobs, countSql, eq, and, desc, gte, lte } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import {
  jsonContent,
  jsonBody,
  errorResponseSchema,
  standardErrors,
  bearerSecurity,
} from './_schemas.js';
import { getSelfHealingConfig } from '../services/self-healing.service.js';
import { getSelfHealingQueue, isQueueAvailable } from '../services/queue.service.js';

type Env = {
  Variables: { user: AuthUser };
};

const errorRoutes = new OpenAPIHono<Env>();

errorRoutes.use('*', authMiddleware);

// Super user guard
errorRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super user access required' }, 403);
  }
  await next();
});

// ── Schemas ──

const errorLogItemSchema = z.object({
  id: z.string(),
  level: z.string(),
  message: z.string(),
  stack: z.string().nullable(),
  path: z.string().nullable(),
  method: z.string().nullable(),
  statusCode: z.number().nullable(),
  resolved: z.boolean(),
  createdAt: z.string(),
}).openapi('ErrorLogItem');

const paginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
}).openapi('ErrorPagination');

const paginatedErrorsSchema = z.object({
  data: z.array(errorLogItemSchema),
  pagination: paginationSchema,
}).openapi('PaginatedErrors');

const successSchema = z.object({
  success: z.boolean(),
}).openapi('SuccessResponse');

const errorListQuerySchema = z.object({
  page: z.string().optional().openapi({ description: 'Page number (default 1)' }),
  limit: z.string().optional().openapi({ description: 'Items per page (default 50, max 100)' }),
  level: z.string().optional().openapi({ description: 'Filter by level' }),
  resolved: z.string().optional().openapi({ description: 'Filter by resolved (true/false)' }),
  path: z.string().optional().openapi({ description: 'Filter by path' }),
});

const idParamSchema = z.object({
  id: z.string().openapi({ description: 'Error log entry ID' }),
});

// ── Routes ──

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Errors'],
  summary: 'List error log entries with filters',
  security: bearerSecurity,
  request: {
    query: errorListQuerySchema,
  },
  responses: {
    200: jsonContent(paginatedErrorsSchema, 'Paginated error log entries'),
    ...standardErrors,
  },
});

errorRoutes.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');
  const page = Math.max(1, Math.min(parseInt(query.page ?? '1', 10) || 1, 10000));
  const limit = Math.min(Math.max(1, parseInt(query.limit ?? '50', 10) || 50), 100);
  const offset = (page - 1) * limit;
  const level = query.level;
  const resolved = query.resolved;
  const path = query.path;

  const conditions = [];
  if (level) conditions.push(eq(errorLog.level, level));
  if (resolved === 'true') conditions.push(eq(errorLog.resolved, true));
  if (resolved === 'false') conditions.push(eq(errorLog.resolved, false));
  if (path) conditions.push(eq(errorLog.path, path));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const logs = await db.query.errorLog.findMany({
    where: where ? () => where : undefined,
    orderBy: (e, { desc: d }) => d(e.createdAt),
    limit,
    offset,
  });

  const [total] = await db
    .select({ count: countSql() })
    .from(errorLog)
    .where(where);

  return c.json({
    data: logs,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  } as any, 200);
});

const getByIdRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Errors'],
  summary: 'Get a single error log entry',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(errorLogItemSchema, 'Error log entry'),
    ...standardErrors,
  },
});

errorRoutes.openapi(getByIdRoute, async (c) => {
  const { id } = c.req.valid('param');
  const entry = await db.query.errorLog.findFirst({
    where: eq(errorLog.id, id),
  });

  if (!entry) {
    return c.json({ error: 'Error log entry not found' }, 404) as any;
  }

  return c.json(entry as any, 200);
});

const resolveRoute = createRoute({
  method: 'patch',
  path: '/{id}/resolve',
  tags: ['Errors'],
  summary: 'Mark an error as resolved',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(successSchema, 'Error marked as resolved'),
    ...standardErrors,
  },
});

errorRoutes.openapi(resolveRoute, async (c) => {
  const { id } = c.req.valid('param');
  const entry = await db.query.errorLog.findFirst({
    where: eq(errorLog.id, id),
  });

  if (!entry) {
    return c.json({ error: 'Error log entry not found' }, 404) as any;
  }

  await db.update(errorLog).set({ resolved: true, status: 'resolved' }).where(eq(errorLog.id, id));

  return c.json({ success: true }, 200);
});

const resolveAllRoute = createRoute({
  method: 'post',
  path: '/resolve-all',
  tags: ['Errors'],
  summary: 'Bulk resolve all unresolved errors',
  security: bearerSecurity,
  responses: {
    200: jsonContent(successSchema, 'All errors resolved'),
    ...standardErrors,
  },
});

errorRoutes.openapi(resolveAllRoute, async (c) => {
  await db.update(errorLog).set({ resolved: true, status: 'resolved' }).where(eq(errorLog.resolved, false));
  return c.json({ success: true }, 200);
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Errors'],
  summary: 'Delete an error log entry',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(successSchema, 'Error log entry deleted'),
    ...standardErrors,
  },
});

errorRoutes.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');
  await db.delete(errorLog).where(eq(errorLog.id, id));
  return c.json({ success: true }, 200);
});

// ── Self-heal an error ──

const selfHealSchema = z.object({
  context: z.string().max(5000).optional(),
  options: z.object({
    autoMerge: z.boolean().default(false),
    autoRelease: z.boolean().default(false),
    autoUpdate: z.boolean().default(false),
    releaseType: z.enum(['alpha', 'release']).default('release'),
  }).optional().default({ autoMerge: false, autoRelease: false, autoUpdate: false, releaseType: 'release' }),
});

const selfHealRoute = createRoute({
  method: 'post',
  path: '/{id}/self-heal',
  tags: ['Errors'],
  summary: 'Trigger self-healing for an error',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
    body: jsonBody(selfHealSchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Self-healing job created'),
    ...standardErrors,
  },
});

errorRoutes.openapi(selfHealRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const user = c.get('user');

  const entry = await db.query.errorLog.findFirst({
    where: eq(errorLog.id, id),
  });

  if (!entry) {
    return c.json({ error: 'Error log entry not found' }, 404);
  }

  // Validate self-healing is configured
  const config = await getSelfHealingConfig();
  if (!config) {
    return c.json({ error: 'Self-healing not configured. Add API keys in Settings.' }, 400);
  }

  // Build prompt from error + optional user context
  const parts = [
    `Fix the following error in the codebase:`,
    ``,
    `Level: ${entry.level}`,
    `Message: ${entry.message}`,
  ];
  if (entry.path) parts.push(`Path: ${entry.method ?? ''} ${entry.path}`);
  if (entry.statusCode) parts.push(`Status Code: ${entry.statusCode}`);
  if (entry.stack) parts.push(`\nStack trace:\n${entry.stack}`);
  if (body.context) parts.push(`\nAdditional context from the admin:\n${body.context}`);

  const prompt = parts.join('\n');

  // Create self-healing job
  const { insertReturning } = await import('@fleet/db');
  const [job] = await insertReturning(selfHealingJobs, {
    prompt,
    baseBranch: config.defaultBranch,
    options: body.options,
    createdBy: user.userId,
  });

  // Update error status
  await db.update(errorLog).set({
    status: 'self_healing',
    selfHealingJobId: job.id,
  }).where(eq(errorLog.id, id));

  // Enqueue
  if (isQueueAvailable()) {
    const queue = getSelfHealingQueue();
    await queue.add('self-healing', { jobId: job.id }, {
      jobId: `sh-${job.id}`,
    });
  } else {
    const { launchWorkerContainer, waitForContainerRunning } = await import('../services/self-healing.service.js');
    launchWorkerContainer(job.id)
      .then((serviceId) => waitForContainerRunning(job.id, serviceId))
      .catch(() => {});
  }

  return c.json(job, 201);
}) as any);

// ── Set error status to pending ──

const setPendingRoute = createRoute({
  method: 'patch',
  path: '/{id}/pending',
  tags: ['Errors'],
  summary: 'Mark an error as pending (assigned to power user)',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(successSchema, 'Error marked as pending'),
    ...standardErrors,
  },
});

errorRoutes.openapi(setPendingRoute, async (c) => {
  const { id } = c.req.valid('param');
  const entry = await db.query.errorLog.findFirst({
    where: eq(errorLog.id, id),
  });

  if (!entry) {
    return c.json({ error: 'Error log entry not found' }, 404) as any;
  }

  await db.update(errorLog).set({ status: 'pending' }).where(eq(errorLog.id, id));

  return c.json({ success: true }, 200);
});

export default errorRoutes;
