import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, logArchives, countSql, eq, and, desc } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { createReadStream } from 'node:fs';
import { stat, unlink } from 'node:fs/promises';
import {
  jsonContent,
  standardErrors,
  bearerSecurity,
} from './_schemas.js';

type Env = {
  Variables: { user: AuthUser };
};

const logArchiveRoutes = new OpenAPIHono<Env>();

logArchiveRoutes.use('*', authMiddleware);

// Super user guard
logArchiveRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super user access required' }, 403);
  }
  await next();
});

// ── Schemas ──

const archiveItemSchema = z.object({
  id: z.string(),
  logType: z.string(),
  accountId: z.string().nullable(),
  dateFrom: z.string(),
  dateTo: z.string(),
  recordCount: z.number(),
  sizeBytes: z.number().nullable(),
  filename: z.string(),
  status: z.string().nullable(),
  createdAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
}).openapi('LogArchiveItem');

const paginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
}).openapi('ArchivePagination');

const paginatedArchivesSchema = z.object({
  data: z.array(archiveItemSchema),
  pagination: paginationSchema,
}).openapi('PaginatedArchives');

const successSchema = z.object({
  success: z.boolean(),
}).openapi('ArchiveSuccessResponse');

const listQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  logType: z.string().optional().openapi({ description: 'Filter by log type (audit or error)' }),
  accountId: z.string().optional().openapi({ description: 'Filter by account ID' }),
});

const idParamSchema = z.object({
  id: z.string().openapi({ description: 'Log archive ID' }),
});

// ── Routes ──

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Log Archives'],
  summary: 'List log archives',
  security: bearerSecurity,
  request: {
    query: listQuerySchema,
  },
  responses: {
    200: jsonContent(paginatedArchivesSchema, 'Paginated log archives'),
    ...standardErrors,
  },
});

logArchiveRoutes.openapi(listRoute, async (c) => {
  const query = c.req.valid('query');
  const page = Math.max(1, Math.min(parseInt(query.page ?? '1', 10) || 1, 10000));
  const limit = Math.min(Math.max(1, parseInt(query.limit ?? '50', 10) || 50), 100);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (query.logType) conditions.push(eq(logArchives.logType, query.logType));
  if (query.accountId) conditions.push(eq(logArchives.accountId, query.accountId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const archives = await db
    .select()
    .from(logArchives)
    .where(where)
    .orderBy(desc(logArchives.createdAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: countSql() })
    .from(logArchives)
    .where(where);

  return c.json({
    data: archives,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  } as any, 200);
});

const downloadRoute = createRoute({
  method: 'get',
  path: '/{id}/download',
  tags: ['Log Archives'],
  summary: 'Download a log archive file',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: {
      description: 'Archive file download',
      content: { 'application/gzip': { schema: z.any() } },
    },
    ...standardErrors,
  },
});

logArchiveRoutes.openapi(downloadRoute, async (c) => {
  const { id } = c.req.valid('param');
  const archive = await db.query.logArchives.findFirst({
    where: eq(logArchives.id, id),
  });

  if (!archive) {
    return c.json({ error: 'Archive not found' }, 404) as any;
  }

  try {
    const fileStat = await stat(archive.filePath);
    c.header('Content-Type', 'application/gzip');
    c.header('Content-Disposition', `attachment; filename="${archive.filename}"`);
    c.header('Content-Length', String(fileStat.size));
    const stream = createReadStream(archive.filePath);
    return c.body(stream as any);
  } catch {
    return c.json({ error: 'Archive file not found on disk' }, 404) as any;
  }
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Log Archives'],
  summary: 'Delete a log archive',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(successSchema, 'Archive deleted'),
    ...standardErrors,
  },
});

logArchiveRoutes.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid('param');
  const archive = await db.query.logArchives.findFirst({
    where: eq(logArchives.id, id),
  });

  if (!archive) {
    return c.json({ error: 'Archive not found' }, 404) as any;
  }

  // Delete file from disk
  try {
    await unlink(archive.filePath);
  } catch (err: any) {
    if (err.code !== 'ENOENT') {
      return c.json({ error: 'Failed to delete archive file' }, 500) as any;
    }
  }

  await db.delete(logArchives).where(eq(logArchives.id, id));
  return c.json({ success: true }, 200);
});

const triggerRoute = createRoute({
  method: 'post',
  path: '/trigger',
  tags: ['Log Archives'],
  summary: 'Manually trigger log archiving',
  security: bearerSecurity,
  responses: {
    200: jsonContent(successSchema, 'Archive job queued'),
    ...standardErrors,
  },
});

logArchiveRoutes.openapi(triggerRoute, async (c) => {
  try {
    const { getMaintenanceQueue, isQueueAvailable } = await import('../services/queue.service.js');
    if (!isQueueAvailable()) {
      return c.json({ error: 'Queue system not available' }, 503) as any;
    }
    await getMaintenanceQueue().add('log-archive', { type: 'log-archive' }, {
      jobId: `manual-log-archive-${Date.now()}`,
    });
    return c.json({ success: true }, 200);
  } catch {
    return c.json({ error: 'Failed to queue archive job' }, 500) as any;
  }
});

export default logArchiveRoutes;
