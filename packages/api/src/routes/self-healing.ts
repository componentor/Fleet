import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, selfHealingJobs, users, eq, desc, countSql } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { getSelfHealingQueue, isQueueAvailable } from '../services/queue.service.js';
import {
  getSelfHealingConfig,
  verifyCallbackToken,
  handleCallback,
  cancelJob,
} from '../services/self-healing.service.js';
import {
  jsonBody,
  jsonContent,
  standardErrors,
  bearerSecurity,
} from './_schemas.js';

type Env = {
  Variables: { user: AuthUser };
};

const selfHealingRoutes = new OpenAPIHono<Env>();

// Auth + super admin guard
selfHealingRoutes.use('*', authMiddleware);
selfHealingRoutes.use('*', async (c, next) => {
  // Allow callback endpoint without super check (uses token auth)
  if (c.req.path.endsWith('/callback') && c.req.method === 'POST') {
    return next();
  }
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super admin access required' }, 403);
  }
  await next();
});

// ── Schemas ──

const createJobSchema = z.object({
  prompt: z.string().min(1).max(10000),
  baseBranch: z.string().optional(),
  options: z.object({
    autoMerge: z.boolean().default(false),
    autoRelease: z.boolean().default(false),
    autoUpdate: z.boolean().default(false),
    releaseType: z.enum(['alpha', 'release']).default('release'),
  }).optional().default({ autoMerge: false, autoRelease: false, autoUpdate: false, releaseType: 'release' }),
});

const listQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.string().optional(),
});

const callbackSchema = z.object({
  status: z.string().optional(),
  log: z.string().optional(),
  workingBranch: z.string().optional(),
  commitSha: z.string().optional(),
  prUrl: z.string().optional(),
  prNumber: z.number().optional(),
  ciStatus: z.string().optional(),
  releaseTag: z.string().optional(),
  error: z.string().optional(),
});

// ── Routes ──

// GET / — list jobs
const listJobsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Self-Healing'],
  summary: 'List self-healing jobs',
  security: bearerSecurity,
  request: { query: listQuerySchema },
  responses: {
    200: jsonContent(z.any(), 'Paginated job list'),
    ...standardErrors,
  },
});

selfHealingRoutes.openapi(listJobsRoute, (async (c: any) => {
  const query = c.req.valid('query');
  const page = Math.max(1, parseInt(query.page ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
  const offset = (page - 1) * limit;

  const conditions: any[] = [];
  if (query.status) conditions.push(eq(selfHealingJobs.status, query.status));

  const whereClause = conditions.length > 0 ? conditions[0] : undefined;

  const jobs = await db
    .select()
    .from(selfHealingJobs)
    .where(whereClause)
    .orderBy(desc(selfHealingJobs.createdAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: countSql() })
    .from(selfHealingJobs)
    .where(whereClause);

  // Enrich with creator info
  const creatorIds = [...new Set(jobs.filter((j: any) => j.createdBy).map((j: any) => j.createdBy))];
  let creatorMap = new Map<string, { name: string | null; email: string | null }>();
  if (creatorIds.length > 0) {
    const { inArray } = await import('@fleet/db');
    const usrs = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, creatorIds));
    creatorMap = new Map(usrs.map((u: any) => [u.id, { name: u.name, email: u.email }]));
  }

  const enriched = jobs.map((j: any) => ({
    ...j,
    creatorName: j.createdBy ? creatorMap.get(j.createdBy)?.name ?? null : null,
    creatorEmail: j.createdBy ? creatorMap.get(j.createdBy)?.email ?? null : null,
  }));

  return c.json({
    data: enriched,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  });
}) as any);

// POST / — create job
const createJobRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Self-Healing'],
  summary: 'Create a new self-healing job',
  security: bearerSecurity,
  request: { body: jsonBody(createJobSchema) },
  responses: {
    201: jsonContent(z.any(), 'Created job'),
    ...standardErrors,
  },
});

selfHealingRoutes.openapi(createJobRoute, (async (c: any) => {
  const body = c.req.valid('json');
  const user = c.get('user');

  // Validate config exists
  const config = await getSelfHealingConfig();
  if (!config) {
    return c.json({ error: 'Self-healing not configured. Add API keys in Settings.' }, 400);
  }

  // Insert DB record
  const { insertReturning } = await import('@fleet/db');
  const [job] = await insertReturning(selfHealingJobs, {
    prompt: body.prompt,
    baseBranch: body.baseBranch || config.defaultBranch,
    options: body.options,
    createdBy: user.userId,
  });

  // Enqueue BullMQ job
  if (isQueueAvailable()) {
    const queue = getSelfHealingQueue();
    await queue.add('self-healing', { jobId: job.id }, {
      jobId: `sh-${job.id}`,
    });
  } else {
    // Local dev fallback — run directly
    const { launchWorkerContainer, waitForContainerRunning } = await import('../services/self-healing.service.js');
    launchWorkerContainer(job.id)
      .then((serviceId) => waitForContainerRunning(job.id, serviceId))
      .catch(() => {});
  }

  return c.json(job, 201);
}) as any);

// GET /:id — get job detail
const getJobRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Self-Healing'],
  summary: 'Get self-healing job detail',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonContent(z.any(), 'Job detail'),
    ...standardErrors,
  },
});

selfHealingRoutes.openapi(getJobRoute, (async (c: any) => {
  const { id } = c.req.valid('param');

  const job = await db.query.selfHealingJobs.findFirst({
    where: eq(selfHealingJobs.id, id),
  });

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  // Enrich with creator info
  let creatorName: string | null = null;
  let creatorEmail: string | null = null;
  if (job.createdBy) {
    const creator = await db.query.users.findFirst({
      where: eq(users.id, job.createdBy),
    });
    creatorName = creator?.name ?? null;
    creatorEmail = creator?.email ?? null;
  }

  return c.json({ ...job, creatorName, creatorEmail });
}) as any);

// POST /:id/cancel — cancel a running job
const cancelJobRoute = createRoute({
  method: 'post',
  path: '/{id}/cancel',
  tags: ['Self-Healing'],
  summary: 'Cancel a running self-healing job',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonContent(z.any(), 'Cancelled job'),
    ...standardErrors,
  },
});

selfHealingRoutes.openapi(cancelJobRoute, (async (c: any) => {
  const { id } = c.req.valid('param');

  try {
    await cancelJob(id);
  } catch (err: any) {
    return c.json({ error: err.message }, 400);
  }

  const job = await db.query.selfHealingJobs.findFirst({
    where: eq(selfHealingJobs.id, id),
  });

  return c.json(job);
}) as any);

// DELETE /:id — delete job record
const deleteJobRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Self-Healing'],
  summary: 'Delete a self-healing job record',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonContent(z.any(), 'Deleted'),
    ...standardErrors,
  },
});

selfHealingRoutes.openapi(deleteJobRoute, (async (c: any) => {
  const { id } = c.req.valid('param');

  const job = await db.query.selfHealingJobs.findFirst({
    where: eq(selfHealingJobs.id, id),
  });

  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const terminalStatuses = ['completed', 'failed', 'cancelled'];
  if (!terminalStatuses.includes(job.status)) {
    return c.json({ error: 'Can only delete completed, failed, or cancelled jobs' }, 400);
  }

  await db.delete(selfHealingJobs).where(eq(selfHealingJobs.id, id));

  return c.json({ message: 'Job deleted' });
}) as any);

// POST /:id/callback — internal callback from container
const callbackRoute = createRoute({
  method: 'post',
  path: '/{id}/callback',
  tags: ['Self-Healing'],
  summary: 'Internal callback from self-healing container',
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(callbackSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'OK'),
    ...standardErrors,
  },
});

selfHealingRoutes.openapi(callbackRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  // Authenticate with callback token (from Authorization header)
  const authHeader = c.req.header('Authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');

  if (!token) {
    return c.json({ error: 'Missing callback token' }, 401);
  }

  const valid = await verifyCallbackToken(id, token);
  if (!valid) {
    return c.json({ error: 'Invalid callback token' }, 403);
  }

  await handleCallback(id, body);

  return c.json({ ok: true });
}) as any);

export default selfHealingRoutes;
