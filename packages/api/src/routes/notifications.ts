import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, notifications, eq, and, desc } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { notificationService } from '../services/notification.service.js';
import {
  jsonContent,
  errorResponseSchema,
  messageResponseSchema,
  standardErrors,
  bearerSecurity,
} from './_schemas.js';

type Env = {
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
};

const notificationRoutes = new OpenAPIHono<Env>();

notificationRoutes.use('*', authMiddleware);
notificationRoutes.use('*', tenantMiddleware);

// ── Schemas ──

const notificationItemSchema = z.object({
  id: z.string(),
  accountId: z.string(),
  userId: z.string().nullable(),
  type: z.string(),
  title: z.string(),
  body: z.string().nullable(),
  resourceType: z.string().nullable().optional(),
  resourceId: z.string().nullable().optional(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
}).openapi('NotificationItem');

const paginatedNotificationsSchema = z.object({
  data: z.array(notificationItemSchema),
  page: z.number(),
  limit: z.number(),
}).openapi('PaginatedNotifications');

const unreadCountSchema = z.object({
  count: z.number(),
}).openapi('UnreadCount');

const paginationQuerySchema = z.object({
  page: z.string().optional().openapi({ description: 'Page number (default 1)' }),
  limit: z.string().optional().openapi({ description: 'Items per page (default 20, max 100)' }),
});

const idParamSchema = z.object({
  id: z.string().openapi({ description: 'Notification ID' }),
});

// ── Routes ──

const listRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Notifications'],
  summary: 'List notifications for current account',
  security: bearerSecurity,
  request: {
    query: paginationQuerySchema,
  },
  responses: {
    200: jsonContent(paginatedNotificationsSchema, 'Paginated notifications'),
    ...standardErrors,
  },
});

notificationRoutes.openapi(listRoute, async (c) => {
  const accountId = c.get('accountId');
  if (!accountId) return c.json({ error: 'Account context required' }, 400) as any;

  const query = c.req.valid('query');
  const page = Math.max(1, parseInt(query.page ?? '1', 10));
  const limit = Math.min(Math.max(1, parseInt(query.limit ?? '20', 10)), 100);
  const offset = (page - 1) * limit;

  const items = await db.query.notifications.findMany({
    where: eq(notifications.accountId, accountId),
    orderBy: (n, { desc: d }) => d(n.createdAt),
    limit,
    offset,
  });

  return c.json({ data: items, page, limit } as any, 200);
});

const unreadCountRoute = createRoute({
  method: 'get',
  path: '/unread-count',
  tags: ['Notifications'],
  summary: 'Get unread notification count',
  security: bearerSecurity,
  responses: {
    200: jsonContent(unreadCountSchema, 'Unread count'),
    ...standardErrors,
  },
});

notificationRoutes.openapi(unreadCountRoute, async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  if (!accountId) return c.json({ error: 'Account context required' }, 400) as any;

  const count = await notificationService.getUnreadCount(accountId, user.userId);
  return c.json({ count }, 200);
});

const markReadRoute = createRoute({
  method: 'patch',
  path: '/{id}/read',
  tags: ['Notifications'],
  summary: 'Mark a notification as read',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Notification marked as read'),
    ...standardErrors,
  },
});

notificationRoutes.openapi(markReadRoute, async (c) => {
  const accountId = c.get('accountId');
  const { id } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400) as any;

  const notification = await db.query.notifications.findFirst({
    where: and(eq(notifications.id, id), eq(notifications.accountId, accountId)),
  });

  if (!notification) {
    return c.json({ error: 'Notification not found' }, 404) as any;
  }

  await notificationService.markRead(id);
  return c.json({ message: 'Notification marked as read' }, 200);
});

const markAllReadRoute = createRoute({
  method: 'post',
  path: '/mark-all-read',
  tags: ['Notifications'],
  summary: 'Mark all notifications as read',
  security: bearerSecurity,
  responses: {
    200: jsonContent(messageResponseSchema, 'All notifications marked as read'),
    ...standardErrors,
  },
});

notificationRoutes.openapi(markAllReadRoute, async (c) => {
  const accountId = c.get('accountId');
  const user = c.get('user');
  if (!accountId) return c.json({ error: 'Account context required' }, 400) as any;

  await notificationService.markAllRead(accountId, user.userId);
  return c.json({ message: 'All notifications marked as read' }, 200);
});

const deleteRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Notifications'],
  summary: 'Delete a notification',
  security: bearerSecurity,
  request: {
    params: idParamSchema,
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Notification deleted'),
    ...standardErrors,
  },
});

notificationRoutes.openapi(deleteRoute, async (c) => {
  const accountId = c.get('accountId');
  const { id } = c.req.valid('param');
  if (!accountId) return c.json({ error: 'Account context required' }, 400) as any;

  const notification = await db.query.notifications.findFirst({
    where: and(eq(notifications.id, id), eq(notifications.accountId, accountId)),
  });

  if (!notification) {
    return c.json({ error: 'Notification not found' }, 404) as any;
  }

  await db.delete(notifications).where(and(eq(notifications.id, id), eq(notifications.accountId, accountId)));
  return c.json({ message: 'Notification deleted' }, 200);
});

export default notificationRoutes;
