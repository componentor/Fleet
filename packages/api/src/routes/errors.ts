import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, errorLog, countSql, eq, and, desc, gte, lte } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import {
  jsonContent,
  errorResponseSchema,
  standardErrors,
  bearerSecurity,
} from './_schemas.js';

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

  await db.update(errorLog).set({ resolved: true }).where(eq(errorLog.id, id));

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
  await db.update(errorLog).set({ resolved: true }).where(eq(errorLog.resolved, false));
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

export default errorRoutes;
