import { Hono } from 'hono';
import { db, notifications, eq, and, desc } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { notificationService } from '../services/notification.service.js';

const notificationRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

notificationRoutes.use('*', authMiddleware);
notificationRoutes.use('*', tenantMiddleware);

// GET / — list notifications for current account (paginated, newest first)
notificationRoutes.get('/', async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const page = Math.max(1, parseInt(c.req.query('page') ?? '1', 10));
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '20', 10)), 100);
  const offset = (page - 1) * limit;

  const items = await db.query.notifications.findMany({
    where: eq(notifications.accountId, accountId),
    orderBy: (n, { desc: d }) => d(n.createdAt),
    limit,
    offset,
  });

  return c.json({ data: items, page, limit });
});

// GET /unread-count — returns unread notification count
notificationRoutes.get('/unread-count', async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const count = await notificationService.getUnreadCount(accountId, user.userId);
  return c.json({ count });
});

// PATCH /:id/read — mark one notification as read
notificationRoutes.patch('/:id/read', async (c) => {
  const accountId = c.get('accountId');
  const id = c.req.param('id');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const notification = await db.query.notifications.findFirst({
    where: and(eq(notifications.id, id), eq(notifications.accountId, accountId)),
  });

  if (!notification) {
    return c.json({ error: 'Notification not found' }, 404);
  }

  await notificationService.markRead(id);
  return c.json({ message: 'Notification marked as read' });
});

// POST /mark-all-read — mark all notifications as read
notificationRoutes.post('/mark-all-read', async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  await notificationService.markAllRead(accountId, user.userId);
  return c.json({ message: 'All notifications marked as read' });
});

// DELETE /:id — delete a notification
notificationRoutes.delete('/:id', async (c) => {
  const accountId = c.get('accountId');
  const id = c.req.param('id');
  if (!accountId) return c.json({ error: 'Account context required' }, 400);

  const notification = await db.query.notifications.findFirst({
    where: and(eq(notifications.id, id), eq(notifications.accountId, accountId)),
  });

  if (!notification) {
    return c.json({ error: 'Notification not found' }, 404);
  }

  await db.delete(notifications).where(and(eq(notifications.id, id), eq(notifications.accountId, accountId)));
  return c.json({ message: 'Notification deleted' });
});

export default notificationRoutes;
