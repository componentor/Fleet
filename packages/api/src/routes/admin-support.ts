import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, supportTickets, supportTicketMessages, users, accounts, insertReturning, updateReturning, countSql, eq, and, or, like, isNull, isNotNull, desc, inArray } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { loadAdminPermissions, requireAdminPermission } from '../middleware/admin-permission.js';
import type { AdminPermissions } from '../middleware/admin-permission.js';
import { notificationService } from '../services/notification.service.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';
import { getValkey } from '../services/valkey.service.js';
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

const adminSupportRoutes = new OpenAPIHono<Env>();

adminSupportRoutes.use('*', authMiddleware);
adminSupportRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper && !user.adminRoleId) {
    return c.json({ error: 'Admin access required' }, 403);
  }
  await next();
});
adminSupportRoutes.use('*', loadAdminPermissions);

// ── Schemas ──

const ticketIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Ticket ID' }),
});

const messageIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Ticket ID' }),
  msgId: z.string().openapi({ description: 'Message ID' }),
});

const ticketQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
  status: z.string().optional(),
  priority: z.string().optional(),
  assignedTo: z.string().optional(),
  search: z.string().optional(),
});

const updateTicketSchema = z.object({
  status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
  assignedTo: z.string().nullable().optional(),
});

const createAdminMessageSchema = z.object({
  body: z.string().min(1),
  isInternal: z.boolean().optional(),
});

const editMessageSchema = z.object({
  body: z.string().min(1),
});

// ── Routes ──

// GET /tickets — list all tickets (admin)
const listTicketsRoute = createRoute({
  method: 'get',
  path: '/tickets',
  tags: ['Admin Support'],
  summary: 'List all support tickets (admin)',
  security: bearerSecurity,
  request: {
    query: ticketQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Paginated ticket list'),
    ...standardErrors,
  },
  middleware: [requireAdminPermission('support', 'read')],
});

adminSupportRoutes.openapi(listTicketsRoute, (async (c: any) => {
  const query = c.req.valid('query');
  const page = Math.max(1, parseInt(query.page ?? '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? '20', 10)));
  const offset = (page - 1) * limit;

  const conditions: any[] = [];
  if (query.status) conditions.push(eq(supportTickets.status, query.status));
  if (query.priority) conditions.push(eq(supportTickets.priority, query.priority));
  if (query.assignedTo) conditions.push(eq(supportTickets.assignedTo, query.assignedTo));
  if (query.search) {
    const sanitized = query.search.replace(/%/g, '\\%').replace(/_/g, '\\_');
    conditions.push(like(supportTickets.subject, `%${sanitized}%`));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const tickets = await db
    .select()
    .from(supportTickets)
    .where(whereClause)
    .orderBy(desc(supportTickets.updatedAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: countSql() })
    .from(supportTickets)
    .where(whereClause);

  // Enrich with account names and creator info
  const accountIds = [...new Set(tickets.map((t: any) => t.accountId))];
  const creatorIds = [...new Set(tickets.map((t: any) => t.createdBy))];
  const assigneeIds = [...new Set(tickets.filter((t: any) => t.assignedTo).map((t: any) => t.assignedTo))];
  const allUserIds = [...new Set([...creatorIds, ...assigneeIds])];

  let accountMap = new Map<string, string>();
  let userMap = new Map<string, { name: string | null; email: string | null }>();

  if (accountIds.length > 0) {
    const accs = await db.select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(inArray(accounts.id, accountIds));
    accountMap = new Map(accs.map((a: any) => [a.id, a.name]));
  }

  if (allUserIds.length > 0) {
    const usrs = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, allUserIds));
    userMap = new Map(usrs.map((u: any) => [u.id, { name: u.name, email: u.email }]));
  }

  const enriched = tickets.map((t: any) => ({
    ...t,
    accountName: accountMap.get(t.accountId) ?? null,
    creatorName: userMap.get(t.createdBy)?.name ?? null,
    creatorEmail: userMap.get(t.createdBy)?.email ?? null,
    assigneeName: t.assignedTo ? userMap.get(t.assignedTo)?.name ?? null : null,
    assigneeEmail: t.assignedTo ? userMap.get(t.assignedTo)?.email ?? null : null,
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

// GET /tickets/:id — get ticket + all messages (including internal)
const getTicketRoute = createRoute({
  method: 'get',
  path: '/tickets/{id}',
  tags: ['Admin Support'],
  summary: 'Get a support ticket with all messages (admin)',
  security: bearerSecurity,
  request: {
    params: ticketIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Ticket with all messages'),
    ...standardErrors,
  },
  middleware: [requireAdminPermission('support', 'read')],
});

adminSupportRoutes.openapi(getTicketRoute, (async (c: any) => {
  const { id } = c.req.valid('param');

  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, id),
  });

  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  // Get all messages including internal notes
  const messages = await db
    .select()
    .from(supportTicketMessages)
    .where(eq(supportTicketMessages.ticketId, id))
    .orderBy(supportTicketMessages.createdAt);

  // Enrich messages with author info
  const authorIds = [...new Set(messages.map((m: any) => m.authorId))];
  let authorMap = new Map<string, { name: string | null; email: string | null }>();
  if (authorIds.length > 0) {
    const usrs = await db.select({ id: users.id, name: users.name, email: users.email })
      .from(users)
      .where(inArray(users.id, authorIds));
    authorMap = new Map(usrs.map((u: any) => [u.id, { name: u.name, email: u.email }]));
  }

  const enrichedMessages = messages.map((m: any) => ({
    ...m,
    authorName: authorMap.get(m.authorId)?.name ?? null,
    authorEmail: authorMap.get(m.authorId)?.email ?? null,
  }));

  // Get account name
  const account = await db.query.accounts.findFirst({
    where: eq(accounts.id, ticket.accountId),
  });

  // Get creator info
  const creator = await db.query.users.findFirst({
    where: eq(users.id, ticket.createdBy),
  });

  // Get assignee info
  const assignee = ticket.assignedTo
    ? await db.query.users.findFirst({ where: eq(users.id, ticket.assignedTo) })
    : null;

  return c.json({
    ...ticket,
    accountName: account?.name ?? null,
    creatorName: creator?.name ?? null,
    creatorEmail: creator?.email ?? null,
    assigneeName: assignee?.name ?? null,
    assigneeEmail: assignee?.email ?? null,
    messages: enrichedMessages,
  });
}) as any);

// PATCH /tickets/:id — update ticket (status, priority, assignee)
const updateTicketRoute = createRoute({
  method: 'patch',
  path: '/tickets/{id}',
  tags: ['Admin Support'],
  summary: 'Update a support ticket (admin)',
  security: bearerSecurity,
  request: {
    params: ticketIdParamSchema,
    body: jsonBody(updateTicketSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated ticket'),
    ...standardErrors,
  },
  middleware: [requireAdminPermission('support', 'write')],
});

adminSupportRoutes.openapi(updateTicketRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const user = c.get('user');

  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, id),
  });

  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (body.status !== undefined) {
    updates.status = body.status;
    if (body.status === 'closed') updates.closedAt = new Date();
    if (body.status !== 'closed' && ticket.status === 'closed') updates.closedAt = null;
  }
  if (body.priority !== undefined) updates.priority = body.priority;
  if (body.assignedTo !== undefined) updates.assignedTo = body.assignedTo;

  const [updated] = await updateReturning(supportTickets, updates, eq(supportTickets.id, id));

  // Audit log for every admin action on support
  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.SUPPORT_TICKET_UPDATED,
    description: `Admin updated support ticket "${ticket.subject}" (${Object.keys(body).join(', ')})`,
    resourceType: 'support_ticket',
    resourceId: id,
    resourceName: ticket.subject,
    source: 'support',
    details: { changes: body, adminUserId: user.userId, adminEmail: user.email },
  });

  // Publish status change for real-time
  if (body.status) {
    try {
      const valkey = await getValkey();
      if (valkey) {
        await valkey.publish(`support:ticket:${id}`, JSON.stringify({
          type: 'status',
          status: body.status,
          updatedBy: user.email,
        }));
      }
    } catch { /* ignore */ }
  }

  return c.json(updated);
}) as any);

// POST /tickets/:id/messages — add reply or internal note (admin)
const addMessageRoute = createRoute({
  method: 'post',
  path: '/tickets/{id}/messages',
  tags: ['Admin Support'],
  summary: 'Add a reply or internal note to a support ticket (admin)',
  security: bearerSecurity,
  request: {
    params: ticketIdParamSchema,
    body: jsonBody(createAdminMessageSchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Created message'),
    ...standardErrors,
  },
  middleware: [requireAdminPermission('support', 'write')],
});

adminSupportRoutes.openapi(addMessageRoute, (async (c: any) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const user = c.get('user');

  const ticket = await db.query.supportTickets.findFirst({
    where: eq(supportTickets.id, id),
  });

  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  const isInternal = body.isInternal ?? false;

  const [message] = await insertReturning(supportTicketMessages, {
    ticketId: id,
    authorId: user.userId,
    body: body.body,
    isInternal,
  });

  // Update ticket timestamp and set to in_progress if it was open
  const ticketUpdates: Record<string, any> = { updatedAt: new Date() };
  if (ticket.status === 'open' && !isInternal) {
    ticketUpdates.status = 'in_progress';
  }
  await updateReturning(supportTickets, ticketUpdates, eq(supportTickets.id, id));

  // Audit log for every support action
  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.SUPPORT_MESSAGE_SENT,
    description: isInternal
      ? `Admin added internal note to ticket "${ticket.subject}"`
      : `Admin replied to support ticket "${ticket.subject}"`,
    resourceType: 'support_ticket',
    resourceId: id,
    resourceName: ticket.subject,
    source: 'support',
    details: { isInternal, adminUserId: user.userId, adminEmail: user.email },
  });

  // Notify the ticket creator if this is NOT an internal note
  if (!isInternal) {
    notificationService.create(ticket.accountId, {
      type: 'support',
      title: 'New reply on your support ticket',
      message: `A support agent replied to "${ticket.subject}"`,
      userId: ticket.createdBy,
      resourceType: 'support_ticket',
      resourceId: id,
    }).catch(() => { /* fire and forget */ });
  }

  // Publish to Valkey for real-time (filter internal for non-admin clients in WS handler)
  try {
    const valkey = await getValkey();
    if (valkey) {
      await valkey.publish(`support:ticket:${id}`, JSON.stringify({
        type: 'message',
        message: { ...message, isInternal },
      }));
    }
  } catch { /* ignore */ }

  return c.json(message, 201);
}) as any);

// PATCH /tickets/:id/messages/:msgId — edit own message (admin)
const editMessageRoute = createRoute({
  method: 'patch',
  path: '/tickets/{id}/messages/{msgId}',
  tags: ['Admin Support'],
  summary: 'Edit own message in a support ticket (admin)',
  security: bearerSecurity,
  request: {
    params: messageIdParamSchema,
    body: jsonBody(editMessageSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated message'),
    ...standardErrors,
  },
  middleware: [requireAdminPermission('support', 'write')],
});

adminSupportRoutes.openapi(editMessageRoute, (async (c: any) => {
  const { id, msgId } = c.req.valid('param');
  const body = c.req.valid('json');
  const user = c.get('user');

  const message = await db.query.supportTicketMessages.findFirst({
    where: and(
      eq(supportTicketMessages.id, msgId),
      eq(supportTicketMessages.ticketId, id),
      eq(supportTicketMessages.authorId, user.userId),
    ),
  });

  if (!message) {
    return c.json({ error: 'Message not found or you are not the author' }, 404);
  }

  const [updated] = await updateReturning(
    supportTicketMessages,
    { body: body.body, updatedAt: new Date() },
    eq(supportTicketMessages.id, msgId),
  );

  return c.json(updated);
}) as any);

// GET /stats — support stats (open/in-progress counts)
const statsRoute = createRoute({
  method: 'get',
  path: '/stats',
  tags: ['Admin Support'],
  summary: 'Get support ticket statistics',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Support stats'),
    ...standardErrors,
  },
  middleware: [requireAdminPermission('support', 'read')],
});

adminSupportRoutes.openapi(statsRoute, (async (c: any) => {
  const [open] = await db
    .select({ count: countSql() })
    .from(supportTickets)
    .where(eq(supportTickets.status, 'open'));

  const [inProgress] = await db
    .select({ count: countSql() })
    .from(supportTickets)
    .where(eq(supportTickets.status, 'in_progress'));

  const [total] = await db
    .select({ count: countSql() })
    .from(supportTickets);

  return c.json({
    open: open?.count ?? 0,
    inProgress: inProgress?.count ?? 0,
    total: total?.count ?? 0,
  });
}) as any);

// GET /assignees — list admin/power users for assignment dropdown
const assigneesRoute = createRoute({
  method: 'get',
  path: '/assignees',
  tags: ['Admin Support'],
  summary: 'List admin/power users for ticket assignment',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'List of assignable users'),
    ...standardErrors,
  },
  middleware: [requireAdminPermission('support', 'read')],
});

adminSupportRoutes.openapi(assigneesRoute, (async (c: any) => {
  const adminUsers = await db
    .select({ id: users.id, name: users.name, email: users.email, avatarUrl: users.avatarUrl })
    .from(users)
    .where(
      and(
        isNull(users.deletedAt),
        or(eq(users.isSuper, true), isNotNull(users.adminRoleId)),
      ),
    )
    .orderBy(users.name);

  return c.json(adminUsers);
}) as any);

export default adminSupportRoutes;
