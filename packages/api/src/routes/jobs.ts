import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import type { Queue, Job } from 'bullmq';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import {
  isQueueAvailable,
  getDeploymentQueue,
  getBackupQueue,
  getMaintenanceQueue,
  getEmailQueue,
} from '../services/queue.service.js';
import { logger } from '../services/logger.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

// ── Queue name mapping ──

const QUEUE_NAMES = ['deployment', 'backup', 'maintenance', 'email'] as const;
type QueueName = (typeof QUEUE_NAMES)[number];

const queueGetters: Record<QueueName, () => Queue> = {
  deployment: getDeploymentQueue,
  backup: getBackupQueue,
  maintenance: getMaintenanceQueue,
  email: getEmailQueue,
};

function getQueueByName(name: string): Queue | null {
  const getter = queueGetters[name as QueueName];
  return getter ? getter() : null;
}

// ── Sensitive field redaction ──

const SENSITIVE_PATTERNS = /secret|password|token|key/i;

function redactSensitiveFields(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveFields);
  }

  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE_PATTERNS.test(key)) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      redacted[key] = redactSensitiveFields(value);
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

// ── Zod schemas ──

const JOB_STATUSES = ['waiting', 'active', 'completed', 'failed', 'delayed'] as const;

const listJobsQuerySchema = z.object({
  queue: z.enum(['deployment', 'backup', 'maintenance', 'email']).optional(),
  status: z.enum(JOB_STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const cleanQuerySchema = z.object({
  status: z.enum(['completed', 'failed']),
  olderThan: z.coerce.number().int().min(0).default(24 * 60 * 60 * 1000),
});

// ── Serialise a BullMQ Job into an API-safe shape ──

function serialiseJob(job: Job, queueShortName: string, status: string) {
  return {
    id: job.id,
    name: job.name,
    queue: queueShortName,
    status,
    data: redactSensitiveFields(job.data),
    progress: job.progress,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason ?? null,
    timestamps: {
      created: job.timestamp ?? null,
      processed: job.processedOn ?? null,
      finished: job.finishedOn ?? null,
    },
    opts: {
      delay: job.opts?.delay ?? null,
      attempts: job.opts?.attempts ?? null,
      backoff: job.opts?.backoff ?? null,
      priority: job.opts?.priority ?? null,
      repeat: job.opts?.repeat ?? null,
    },
  };
}

// ── Rate limiters ──

const listRateLimit = rateLimiter({ windowMs: 60_000, max: 120, keyPrefix: 'jobs:list' });
const actionRateLimit = rateLimiter({ windowMs: 60_000, max: 30, keyPrefix: 'jobs:action' });

// ── Router ──

const jobRoutes = new OpenAPIHono<{
  Variables: { user: AuthUser };
}>();

// Auth + super user guard on all routes
jobRoutes.use('*', authMiddleware);
jobRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super user access required' }, 403);
  }
  await next();
});

// Guard: ensure queue system is available
function ensureQueuesAvailable() {
  if (!isQueueAvailable()) {
    return { error: 'Queue system is not available (Valkey may be offline)' };
  }
  return null;
}

// ── GET / — List jobs across all queues (or a specific one) ──

const listJobsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Jobs'],
  summary: 'List jobs across all queues',
  security: bearerSecurity,
  request: {
    query: listJobsQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Paginated list of jobs'),
    503: jsonContent(errorResponseSchema, 'Queue system unavailable'),
    ...standardErrors,
  },
  middleware: [listRateLimit],
});

jobRoutes.openapi(listJobsRoute, (async (c: any) => {
  const unavailable = ensureQueuesAvailable();
  if (unavailable) return c.json(unavailable, 503);

  const { queue: queueFilter, status: statusFilter, page, limit } = c.req.valid('query');
  const offset = (page - 1) * limit;

  // Determine which queues to query
  const queuesToQuery: { name: QueueName; queue: Queue }[] = [];
  if (queueFilter) {
    queuesToQuery.push({ name: queueFilter, queue: getQueueByName(queueFilter)! });
  } else {
    for (const name of QUEUE_NAMES) {
      queuesToQuery.push({ name, queue: queueGetters[name]() });
    }
  }

  // Determine which statuses to query
  const statusesToQuery = statusFilter ? [statusFilter] : [...JOB_STATUSES];

  // Collect jobs from each queue and status
  const allJobs: { job: Job; queueName: QueueName; status: string }[] = [];

  await Promise.all(
    queuesToQuery.map(async ({ name, queue }) => {
      for (const status of statusesToQuery) {
        try {
          const jobs = await queue.getJobs([status]);
          for (const job of jobs) {
            if (job) {
              allJobs.push({ job, queueName: name, status });
            }
          }
        } catch (err) {
          logger.warn({ err, queue: name, status }, 'Failed to fetch jobs for queue/status');
        }
      }
    }),
  );

  // Sort by creation time descending (newest first)
  allJobs.sort((a, b) => (b.job.timestamp ?? 0) - (a.job.timestamp ?? 0));

  const total = allJobs.length;
  const paginatedJobs = allJobs.slice(offset, offset + limit);

  return c.json({
    data: paginatedJobs.map(({ job, queueName, status }) => serialiseJob(job, queueName, status)),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
}) as any);

// ── GET /queues — Overview of all queues ──

const listQueuesRoute = createRoute({
  method: 'get',
  path: '/queues',
  tags: ['Jobs'],
  summary: 'Overview of all queues',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Queue overview'),
    503: jsonContent(errorResponseSchema, 'Queue system unavailable'),
    ...standardErrors,
  },
  middleware: [listRateLimit],
});

jobRoutes.openapi(listQueuesRoute, (async (c: any) => {
  const unavailable = ensureQueuesAvailable();
  if (unavailable) return c.json(unavailable, 503);

  const queueOverviews = await Promise.all(
    QUEUE_NAMES.map(async (name) => {
      const queue = queueGetters[name]();
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed');
        const isPaused = await queue.isPaused();
        return {
          name,
          fullName: queue.name,
          isPaused,
          counts: {
            waiting: counts['waiting'] ?? 0,
            active: counts['active'] ?? 0,
            completed: counts['completed'] ?? 0,
            failed: counts['failed'] ?? 0,
            delayed: counts['delayed'] ?? 0,
          },
        };
      } catch (err) {
        logger.warn({ err, queue: name }, 'Failed to fetch queue overview');
        return {
          name,
          fullName: queue.name,
          isPaused: false,
          counts: { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 },
          error: 'Failed to fetch queue info',
        };
      }
    }),
  );

  return c.json({ data: queueOverviews });
}) as any);

// ── GET /:queue/:id — Single job detail with logs ──

const getJobDetailRoute = createRoute({
  method: 'get',
  path: '/{queue}/{id}',
  tags: ['Jobs'],
  summary: 'Get single job detail with logs',
  security: bearerSecurity,
  request: {
    params: z.object({
      queue: z.string(),
      id: z.string(),
    }),
  },
  responses: {
    200: jsonContent(z.any(), 'Job detail'),
    503: jsonContent(errorResponseSchema, 'Queue system unavailable'),
    ...standardErrors,
  },
  middleware: [listRateLimit],
});

jobRoutes.openapi(getJobDetailRoute, (async (c: any) => {
  const unavailable = ensureQueuesAvailable();
  if (unavailable) return c.json(unavailable, 503);

  const { queue: queueName, id: jobId } = c.req.valid('param');

  const queue = getQueueByName(queueName);
  if (!queue) {
    return c.json({ error: `Unknown queue: ${queueName}. Valid queues: ${QUEUE_NAMES.join(', ')}` }, 400);
  }

  const job = await queue.getJob(jobId);
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  // Determine job state
  const state = await job.getState();

  // Fetch logs
  let logs: { logs: string[]; count: number } = { logs: [], count: 0 };
  try {
    logs = await queue.getJobLogs(jobId);
  } catch {
    // Some jobs may not have logs
  }

  return c.json({
    id: job.id,
    name: job.name,
    queue: queueName,
    status: state,
    data: redactSensitiveFields(job.data),
    returnvalue: redactSensitiveFields(job.returnvalue),
    progress: job.progress,
    attemptsMade: job.attemptsMade,
    failedReason: job.failedReason ?? null,
    stacktrace: job.stacktrace ?? [],
    logs: logs.logs,
    logCount: logs.count,
    timestamps: {
      created: job.timestamp ?? null,
      processed: job.processedOn ?? null,
      finished: job.finishedOn ?? null,
    },
    opts: {
      delay: job.opts?.delay ?? null,
      attempts: job.opts?.attempts ?? null,
      backoff: job.opts?.backoff ?? null,
      priority: job.opts?.priority ?? null,
      repeat: job.opts?.repeat ?? null,
    },
  });
}) as any);

// ── POST /:queue/:id/retry — Retry a failed job ──

const retryJobRoute = createRoute({
  method: 'post',
  path: '/{queue}/{id}/retry',
  tags: ['Jobs'],
  summary: 'Retry a failed job',
  security: bearerSecurity,
  request: {
    params: z.object({
      queue: z.string(),
      id: z.string(),
    }),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Job re-queued for retry'),
    409: jsonContent(errorResponseSchema, 'Job not in failed state'),
    503: jsonContent(errorResponseSchema, 'Queue system unavailable'),
    ...standardErrors,
  },
  middleware: [actionRateLimit],
});

jobRoutes.openapi(retryJobRoute, (async (c: any) => {
  const unavailable = ensureQueuesAvailable();
  if (unavailable) return c.json(unavailable, 503);

  const { queue: queueName, id: jobId } = c.req.valid('param');

  const queue = getQueueByName(queueName);
  if (!queue) {
    return c.json({ error: `Unknown queue: ${queueName}. Valid queues: ${QUEUE_NAMES.join(', ')}` }, 400);
  }

  const job = await queue.getJob(jobId);
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const state = await job.getState();
  if (state !== 'failed') {
    return c.json({ error: `Cannot retry job in state '${state}'. Only failed jobs can be retried.` }, 409);
  }

  try {
    await job.retry(state);
    logger.info({ queue: queueName, jobId, user: c.get('user').email }, 'Job retried by admin');
    return c.json({ message: 'Job has been re-queued for retry', jobId, queue: queueName });
  } catch (err) {
    logger.error({ err, queue: queueName, jobId }, 'Failed to retry job');
    return c.json({ error: 'Failed to retry job' }, 500);
  }
}) as any);

// ── POST /:queue/:id/promote — Promote a delayed job ──

const promoteJobRoute = createRoute({
  method: 'post',
  path: '/{queue}/{id}/promote',
  tags: ['Jobs'],
  summary: 'Promote a delayed job',
  security: bearerSecurity,
  request: {
    params: z.object({
      queue: z.string(),
      id: z.string(),
    }),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Job promoted to waiting'),
    409: jsonContent(errorResponseSchema, 'Job not in delayed state'),
    503: jsonContent(errorResponseSchema, 'Queue system unavailable'),
    ...standardErrors,
  },
  middleware: [actionRateLimit],
});

jobRoutes.openapi(promoteJobRoute, (async (c: any) => {
  const unavailable = ensureQueuesAvailable();
  if (unavailable) return c.json(unavailable, 503);

  const { queue: queueName, id: jobId } = c.req.valid('param');

  const queue = getQueueByName(queueName);
  if (!queue) {
    return c.json({ error: `Unknown queue: ${queueName}. Valid queues: ${QUEUE_NAMES.join(', ')}` }, 400);
  }

  const job = await queue.getJob(jobId);
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  const state = await job.getState();
  if (state !== 'delayed') {
    return c.json({ error: `Cannot promote job in state '${state}'. Only delayed jobs can be promoted.` }, 409);
  }

  try {
    await job.promote();
    logger.info({ queue: queueName, jobId, user: c.get('user').email }, 'Job promoted by admin');
    return c.json({ message: 'Job has been promoted to waiting', jobId, queue: queueName });
  } catch (err) {
    logger.error({ err, queue: queueName, jobId }, 'Failed to promote job');
    return c.json({ error: 'Failed to promote job' }, 500);
  }
}) as any);

// ── DELETE /:queue/:id — Remove a job ──

const removeJobRoute = createRoute({
  method: 'delete',
  path: '/{queue}/{id}',
  tags: ['Jobs'],
  summary: 'Remove a job',
  security: bearerSecurity,
  request: {
    params: z.object({
      queue: z.string(),
      id: z.string(),
    }),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Job removed'),
    503: jsonContent(errorResponseSchema, 'Queue system unavailable'),
    ...standardErrors,
  },
  middleware: [actionRateLimit],
});

jobRoutes.openapi(removeJobRoute, (async (c: any) => {
  const unavailable = ensureQueuesAvailable();
  if (unavailable) return c.json(unavailable, 503);

  const { queue: queueName, id: jobId } = c.req.valid('param');

  const queue = getQueueByName(queueName);
  if (!queue) {
    return c.json({ error: `Unknown queue: ${queueName}. Valid queues: ${QUEUE_NAMES.join(', ')}` }, 400);
  }

  const job = await queue.getJob(jobId);
  if (!job) {
    return c.json({ error: 'Job not found' }, 404);
  }

  try {
    await job.remove();
    logger.info({ queue: queueName, jobId, user: c.get('user').email }, 'Job removed by admin');
    return c.json({ message: 'Job removed', jobId, queue: queueName });
  } catch (err) {
    logger.error({ err, queue: queueName, jobId }, 'Failed to remove job');
    return c.json({ error: 'Failed to remove job' }, 500);
  }
}) as any);

// ── POST /queues/:name/pause — Pause a queue ──

const pauseQueueRoute = createRoute({
  method: 'post',
  path: '/queues/{name}/pause',
  tags: ['Jobs'],
  summary: 'Pause a queue',
  security: bearerSecurity,
  request: {
    params: z.object({ name: z.string() }),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Queue paused'),
    503: jsonContent(errorResponseSchema, 'Queue system unavailable'),
    ...standardErrors,
  },
  middleware: [actionRateLimit],
});

jobRoutes.openapi(pauseQueueRoute, (async (c: any) => {
  const unavailable = ensureQueuesAvailable();
  if (unavailable) return c.json(unavailable, 503);

  const { name: queueName } = c.req.valid('param');
  const queue = getQueueByName(queueName);
  if (!queue) {
    return c.json({ error: `Unknown queue: ${queueName}. Valid queues: ${QUEUE_NAMES.join(', ')}` }, 400);
  }

  try {
    await queue.pause();
    logger.info({ queue: queueName, user: c.get('user').email }, 'Queue paused by admin');
    return c.json({ message: `Queue '${queueName}' has been paused`, queue: queueName });
  } catch (err) {
    logger.error({ err, queue: queueName }, 'Failed to pause queue');
    return c.json({ error: 'Failed to pause queue' }, 500);
  }
}) as any);

// ── POST /queues/:name/resume — Resume a queue ──

const resumeQueueRoute = createRoute({
  method: 'post',
  path: '/queues/{name}/resume',
  tags: ['Jobs'],
  summary: 'Resume a queue',
  security: bearerSecurity,
  request: {
    params: z.object({ name: z.string() }),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Queue resumed'),
    503: jsonContent(errorResponseSchema, 'Queue system unavailable'),
    ...standardErrors,
  },
  middleware: [actionRateLimit],
});

jobRoutes.openapi(resumeQueueRoute, (async (c: any) => {
  const unavailable = ensureQueuesAvailable();
  if (unavailable) return c.json(unavailable, 503);

  const { name: queueName } = c.req.valid('param');
  const queue = getQueueByName(queueName);
  if (!queue) {
    return c.json({ error: `Unknown queue: ${queueName}. Valid queues: ${QUEUE_NAMES.join(', ')}` }, 400);
  }

  try {
    await queue.resume();
    logger.info({ queue: queueName, user: c.get('user').email }, 'Queue resumed by admin');
    return c.json({ message: `Queue '${queueName}' has been resumed`, queue: queueName });
  } catch (err) {
    logger.error({ err, queue: queueName }, 'Failed to resume queue');
    return c.json({ error: 'Failed to resume queue' }, 500);
  }
}) as any);

// ── POST /queues/:name/clean — Clean old jobs from a queue ──

const cleanQueueRoute = createRoute({
  method: 'post',
  path: '/queues/{name}/clean',
  tags: ['Jobs'],
  summary: 'Clean old jobs from a queue',
  security: bearerSecurity,
  request: {
    params: z.object({ name: z.string() }),
    query: cleanQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Clean result'),
    503: jsonContent(errorResponseSchema, 'Queue system unavailable'),
    ...standardErrors,
  },
  middleware: [actionRateLimit],
});

jobRoutes.openapi(cleanQueueRoute, (async (c: any) => {
  const unavailable = ensureQueuesAvailable();
  if (unavailable) return c.json(unavailable, 503);

  const { name: queueName } = c.req.valid('param');
  const queue = getQueueByName(queueName);
  if (!queue) {
    return c.json({ error: `Unknown queue: ${queueName}. Valid queues: ${QUEUE_NAMES.join(', ')}` }, 400);
  }

  const { status, olderThan } = c.req.valid('query');

  try {
    const removed = await queue.clean(olderThan, 0, status);
    logger.info(
      { queue: queueName, status, olderThan, removedCount: removed.length, user: c.get('user').email },
      'Queue cleaned by admin',
    );
    return c.json({
      message: `Cleaned ${removed.length} ${status} jobs from '${queueName}'`,
      queue: queueName,
      removedCount: removed.length,
      removedJobIds: removed,
    });
  } catch (err) {
    logger.error({ err, queue: queueName }, 'Failed to clean queue');
    return c.json({ error: 'Failed to clean queue' }, 500);
  }
}) as any);

export default jobRoutes;
