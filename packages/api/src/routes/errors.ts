import { Hono } from 'hono';
import { db, errorLog, countSql, eq, and, desc, gte, lte } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';

const errorRoutes = new Hono<{
  Variables: { user: AuthUser };
}>();

errorRoutes.use('*', authMiddleware);

// Super user guard
errorRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super user access required' }, 403);
  }
  await next();
});

// GET / — paginated error list with filters
errorRoutes.get('/', async (c) => {
  const page = Math.max(1, Math.min(parseInt(c.req.query('page') ?? '1', 10) || 1, 10000));
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '50', 10) || 50), 100);
  const offset = (page - 1) * limit;
  const level = c.req.query('level');
  const resolved = c.req.query('resolved');
  const path = c.req.query('path');

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
  });
});

// GET /:id — single error detail
errorRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const entry = await db.query.errorLog.findFirst({
    where: eq(errorLog.id, id),
  });

  if (!entry) {
    return c.json({ error: 'Error log entry not found' }, 404);
  }

  return c.json(entry);
});

// PATCH /:id/resolve — mark as resolved
errorRoutes.patch('/:id/resolve', async (c) => {
  const id = c.req.param('id');
  const entry = await db.query.errorLog.findFirst({
    where: eq(errorLog.id, id),
  });

  if (!entry) {
    return c.json({ error: 'Error log entry not found' }, 404);
  }

  await db.update(errorLog).set({ resolved: true }).where(eq(errorLog.id, id));

  return c.json({ success: true });
});

// POST /resolve-all — bulk resolve all unresolved
errorRoutes.post('/resolve-all', async (c) => {
  await db.update(errorLog).set({ resolved: true }).where(eq(errorLog.resolved, false));
  return c.json({ success: true });
});

// DELETE /:id — delete a single error entry
errorRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await db.delete(errorLog).where(eq(errorLog.id, id));
  return c.json({ success: true });
});

export default errorRoutes;
