import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, supportTickets, supportTicketMessages, platformSettings, insertReturning, updateReturning, countSql, eq, and, desc } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware } from '../middleware/tenant.js';
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
  Variables: { user: AuthUser; accountId: string };
};

const supportRoutes = new OpenAPIHono<Env>();

supportRoutes.use('*', authMiddleware);
supportRoutes.use('*', tenantMiddleware);

// Helper: check if support is enabled
async function isSupportEnabled(): Promise<boolean> {
  const setting = await db.query.platformSettings.findFirst({
    where: eq(platformSettings.key, 'support:enabled'),
  });
  if (!setting) return false;
  const val = setting.value;
  return val === true || val === 'true' || (typeof val === 'object' && val !== null && (val as any).enabled === true);
}

// ── Schemas ──

const ticketIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Ticket ID' }),
});

const messageIdParamSchema = z.object({
  id: z.string().openapi({ description: 'Ticket ID' }),
  msgId: z.string().openapi({ description: 'Message ID' }),
});

const createTicketSchema = z.object({
  subject: z.string().min(1).max(255),
  body: z.string().min(1),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
});

const createMessageSchema = z.object({
  body: z.string().min(1),
});

const editMessageSchema = z.object({
  body: z.string().min(1),
});

const paginationQuerySchema = z.object({
  page: z.string().optional(),
  limit: z.string().optional(),
});

// ── Routes ──

// GET /enabled — check if support is enabled
const enabledRoute = createRoute({
  method: 'get',
  path: '/enabled',
  tags: ['Support'],
  summary: 'Check if support feature is enabled',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.any(), 'Support enabled status'),
    ...standardErrors,
  },
});

supportRoutes.openapi(enabledRoute, (async (c: any) => {
  const enabled = await isSupportEnabled();
  return c.json({ enabled });
}) as any);

// GET /tickets — list own account's tickets
const listTicketsRoute = createRoute({
  method: 'get',
  path: '/tickets',
  tags: ['Support'],
  summary: 'List support tickets for current account',
  security: bearerSecurity,
  request: {
    query: paginationQuerySchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Paginated ticket list'),
    ...standardErrors,
  },
});

supportRoutes.openapi(listTicketsRoute, (async (c: any) => {
  const enabled = await isSupportEnabled();
  if (!enabled) return c.json({ error: 'Support is not enabled' }, 403);

  const accountId = c.get('accountId');
  const query = c.req.valid('query');
  const page = Math.max(1, parseInt(query.page ?? '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(query.limit ?? '20', 10)));
  const offset = (page - 1) * limit;

  const tickets = await db
    .select()
    .from(supportTickets)
    .where(eq(supportTickets.accountId, accountId))
    .orderBy(desc(supportTickets.updatedAt))
    .limit(limit)
    .offset(offset);

  const [total] = await db
    .select({ count: countSql() })
    .from(supportTickets)
    .where(eq(supportTickets.accountId, accountId));

  return c.json({
    data: tickets,
    pagination: {
      page,
      limit,
      total: total?.count ?? 0,
      totalPages: Math.ceil((total?.count ?? 0) / limit),
    },
  });
}) as any);

// GET /tickets/:id — get ticket + messages (own account only, filter out internal)
const getTicketRoute = createRoute({
  method: 'get',
  path: '/tickets/{id}',
  tags: ['Support'],
  summary: 'Get a support ticket with messages',
  security: bearerSecurity,
  request: {
    params: ticketIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Ticket with messages'),
    ...standardErrors,
  },
});

supportRoutes.openapi(getTicketRoute, (async (c: any) => {
  const enabled = await isSupportEnabled();
  if (!enabled) return c.json({ error: 'Support is not enabled' }, 403);

  const accountId = c.get('accountId');
  const { id } = c.req.valid('param');

  const ticket = await db.query.supportTickets.findFirst({
    where: and(eq(supportTickets.id, id), eq(supportTickets.accountId, accountId)),
  });

  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  const messages = await db
    .select()
    .from(supportTicketMessages)
    .where(and(
      eq(supportTicketMessages.ticketId, id),
      eq(supportTicketMessages.isInternal, false),
    ))
    .orderBy(supportTicketMessages.createdAt);

  return c.json({ ...ticket, messages });
}) as any);

// POST /tickets — create ticket
const createTicketRoute = createRoute({
  method: 'post',
  path: '/tickets',
  tags: ['Support'],
  summary: 'Create a new support ticket',
  security: bearerSecurity,
  request: {
    body: jsonBody(createTicketSchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Created ticket'),
    ...standardErrors,
  },
});

supportRoutes.openapi(createTicketRoute, (async (c: any) => {
  const enabled = await isSupportEnabled();
  if (!enabled) return c.json({ error: 'Support is not enabled' }, 403);

  const accountId = c.get('accountId');
  const user = c.get('user');
  const body = c.req.valid('json');

  const [ticket] = await insertReturning(supportTickets, {
    subject: body.subject,
    priority: body.priority ?? 'normal',
    accountId,
    createdBy: user.userId,
  });

  // Create initial message
  const [message] = await insertReturning(supportTicketMessages, {
    ticketId: ticket!.id,
    authorId: user.userId,
    body: body.body,
    isInternal: false,
  });

  eventService.log({
    ...eventContext(c),
    accountId,
    eventType: EventTypes.SUPPORT_TICKET_CREATED,
    description: `Created support ticket "${body.subject}"`,
    resourceType: 'support_ticket',
    resourceId: ticket!.id,
    resourceName: body.subject,
  });

  // Publish to Valkey for real-time
  try {
    const valkey = await getValkey();
    if (valkey) {
      await valkey.publish(`support:ticket:${ticket!.id}`, JSON.stringify({
        type: 'message',
        message,
      }));
    }
  } catch { /* ignore */ }

  return c.json({ ...ticket, messages: [message] }, 201);
}) as any);

// POST /tickets/:id/messages — add reply
const addMessageRoute = createRoute({
  method: 'post',
  path: '/tickets/{id}/messages',
  tags: ['Support'],
  summary: 'Add a reply to a support ticket',
  security: bearerSecurity,
  request: {
    params: ticketIdParamSchema,
    body: jsonBody(createMessageSchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Created message'),
    ...standardErrors,
  },
});

supportRoutes.openapi(addMessageRoute, (async (c: any) => {
  const enabled = await isSupportEnabled();
  if (!enabled) return c.json({ error: 'Support is not enabled' }, 403);

  const accountId = c.get('accountId');
  const user = c.get('user');
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');

  const ticket = await db.query.supportTickets.findFirst({
    where: and(eq(supportTickets.id, id), eq(supportTickets.accountId, accountId)),
  });

  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  if (ticket.status === 'closed') {
    return c.json({ error: 'Cannot reply to a closed ticket. Reopen it first.' }, 400);
  }

  const [message] = await insertReturning(supportTicketMessages, {
    ticketId: id,
    authorId: user.userId,
    body: body.body,
    isInternal: false,
  });

  // Update ticket timestamp
  await updateReturning(supportTickets, { updatedAt: new Date() }, eq(supportTickets.id, id));

  eventService.log({
    ...eventContext(c),
    accountId,
    eventType: EventTypes.SUPPORT_MESSAGE_SENT,
    description: `Replied to support ticket "${ticket.subject}"`,
    resourceType: 'support_ticket',
    resourceId: id,
    resourceName: ticket.subject,
  });

  // Publish to Valkey for real-time
  try {
    const valkey = await getValkey();
    if (valkey) {
      await valkey.publish(`support:ticket:${id}`, JSON.stringify({
        type: 'message',
        message,
      }));
    }
  } catch { /* ignore */ }

  return c.json(message, 201);
}) as any);

// PATCH /tickets/:id/messages/:msgId — edit own message
const editMessageRoute = createRoute({
  method: 'patch',
  path: '/tickets/{id}/messages/{msgId}',
  tags: ['Support'],
  summary: 'Edit own message in a support ticket',
  security: bearerSecurity,
  request: {
    params: messageIdParamSchema,
    body: jsonBody(editMessageSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Updated message'),
    ...standardErrors,
  },
});

supportRoutes.openapi(editMessageRoute, (async (c: any) => {
  const enabled = await isSupportEnabled();
  if (!enabled) return c.json({ error: 'Support is not enabled' }, 403);

  const accountId = c.get('accountId');
  const user = c.get('user');
  const { id, msgId } = c.req.valid('param');
  const body = c.req.valid('json');

  // Verify ticket belongs to account
  const ticket = await db.query.supportTickets.findFirst({
    where: and(eq(supportTickets.id, id), eq(supportTickets.accountId, accountId)),
  });

  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

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

// PATCH /tickets/:id/close — close own ticket
const closeTicketRoute = createRoute({
  method: 'patch',
  path: '/tickets/{id}/close',
  tags: ['Support'],
  summary: 'Close a support ticket',
  security: bearerSecurity,
  request: {
    params: ticketIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Closed ticket'),
    ...standardErrors,
  },
});

supportRoutes.openapi(closeTicketRoute, (async (c: any) => {
  const enabled = await isSupportEnabled();
  if (!enabled) return c.json({ error: 'Support is not enabled' }, 403);

  const accountId = c.get('accountId');
  const { id } = c.req.valid('param');

  const ticket = await db.query.supportTickets.findFirst({
    where: and(eq(supportTickets.id, id), eq(supportTickets.accountId, accountId)),
  });

  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  if (ticket.status === 'closed') {
    return c.json({ error: 'Ticket is already closed' }, 400);
  }

  const [updated] = await updateReturning(
    supportTickets,
    { status: 'closed', closedAt: new Date(), updatedAt: new Date() },
    eq(supportTickets.id, id),
  );

  eventService.log({
    ...eventContext(c),
    accountId,
    eventType: EventTypes.SUPPORT_TICKET_CLOSED,
    description: `Closed support ticket "${ticket.subject}"`,
    resourceType: 'support_ticket',
    resourceId: id,
    resourceName: ticket.subject,
  });

  // Publish status change for real-time
  try {
    const valkey = await getValkey();
    if (valkey) {
      await valkey.publish(`support:ticket:${id}`, JSON.stringify({
        type: 'status',
        status: 'closed',
      }));
    }
  } catch { /* ignore */ }

  return c.json(updated);
}) as any);

// PATCH /tickets/:id/reopen — reopen own ticket
const reopenTicketRoute = createRoute({
  method: 'patch',
  path: '/tickets/{id}/reopen',
  tags: ['Support'],
  summary: 'Reopen a closed support ticket',
  security: bearerSecurity,
  request: {
    params: ticketIdParamSchema,
  },
  responses: {
    200: jsonContent(z.any(), 'Reopened ticket'),
    ...standardErrors,
  },
});

supportRoutes.openapi(reopenTicketRoute, (async (c: any) => {
  const enabled = await isSupportEnabled();
  if (!enabled) return c.json({ error: 'Support is not enabled' }, 403);

  const accountId = c.get('accountId');
  const { id } = c.req.valid('param');

  const ticket = await db.query.supportTickets.findFirst({
    where: and(eq(supportTickets.id, id), eq(supportTickets.accountId, accountId)),
  });

  if (!ticket) {
    return c.json({ error: 'Ticket not found' }, 404);
  }

  if (ticket.status !== 'closed') {
    return c.json({ error: 'Ticket is not closed' }, 400);
  }

  const [updated] = await updateReturning(
    supportTickets,
    { status: 'open', closedAt: null, updatedAt: new Date() },
    eq(supportTickets.id, id),
  );

  eventService.log({
    ...eventContext(c),
    accountId,
    eventType: EventTypes.SUPPORT_TICKET_REOPENED,
    description: `Reopened support ticket "${ticket.subject}"`,
    resourceType: 'support_ticket',
    resourceId: id,
    resourceName: ticket.subject,
  });

  // Publish status change for real-time
  try {
    const valkey = await getValkey();
    if (valkey) {
      await valkey.publish(`support:ticket:${id}`, JSON.stringify({
        type: 'status',
        status: 'open',
      }));
    }
  } catch { /* ignore */ }

  return c.json(updated);
}) as any);

export default supportRoutes;
