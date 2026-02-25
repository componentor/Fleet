import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { backupService } from '../services/backup.service.js';
import { schedulerService } from '../services/scheduler.service.js';
import { requireMember } from '../middleware/rbac.js';
import { logger } from '../services/logger.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

const backupRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'backup' });

const backupRoutes = new OpenAPIHono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

backupRoutes.use('*', authMiddleware);
backupRoutes.use('*', tenantMiddleware);

// GET /quota — backup storage quota for account
const getQuotaRoute = createRoute({
  method: 'get',
  path: '/quota',
  tags: ['Backups'],
  summary: 'Get backup storage quota for the current account',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      usedBytes: z.number(),
      limitBytes: z.number(),
      usedGb: z.number(),
      limitGb: z.number(),
      percentUsed: z.number(),
    }), 'Backup quota'),
    ...standardErrors,
  },
});

backupRoutes.openapi(getQuotaRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const quota = await backupService.getBackupQuota(accountId);
  return c.json(quota);
}) as any);

// GET / — list backups for account
const listBackupsRoute = createRoute({
  method: 'get',
  path: '/',
  tags: ['Backups'],
  summary: 'List backups for the current account',
  security: bearerSecurity,
  request: {
    query: z.object({
      serviceId: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: jsonContent(z.any(), 'List of backups'),
    ...standardErrors,
  },
});

backupRoutes.openapi(listBackupsRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { serviceId } = c.req.valid('query');

  const result = await backupService.listBackups(
    accountId,
    serviceId ?? undefined,
  );

  return c.json(result);
}) as any);

// POST / — create manual backup
const createBackupSchema = z.object({
  serviceId: z.string().uuid().optional(),
  storageBackend: z.enum(['nfs', 'local', 'object']).default('nfs'),
  clusterId: z.string().uuid().optional(),
});

const createBackupRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Backups'],
  summary: 'Create a manual backup',
  security: bearerSecurity,
  request: {
    body: jsonBody(createBackupSchema),
  },
  responses: {
    201: jsonContent(z.object({
      id: z.string(),
      status: z.string(),
      storagePath: z.string().nullable(),
      sizeBytes: z.string(),
    }), 'Backup created'),
    ...standardErrors,
  },
  middleware: [backupRateLimit, requireMember],
});

backupRoutes.openapi(createBackupRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const data = c.req.valid('json');

  try {
    const backup = await backupService.createBackup(
      accountId,
      data.serviceId,
      data.storageBackend,
      { clusterId: data.clusterId },
    );

    eventService.log({
      ...eventContext(c),
      eventType: EventTypes.BACKUP_CREATED,
      description: `Created backup for '${data.serviceId ?? 'account'}'`,
      resourceType: 'backup',
      resourceId: backup.id,
    });

    return c.json({
      id: backup.id,
      status: backup.status,
      storagePath: backup.storagePath,
      sizeBytes: backup.sizeBytes.toString(),
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('Backup quota exceeded')) {
      return c.json({ error: message }, 409);
    }
    logger.error({ err }, 'Backup creation failed');
    return c.json({ error: 'Failed to create backup' }, 500);
  }
}) as any);

// GET /schedules — list backup schedules
const listSchedulesRoute = createRoute({
  method: 'get',
  path: '/schedules',
  tags: ['Backups'],
  summary: 'List backup schedules',
  security: bearerSecurity,
  request: {
    query: z.object({
      serviceId: z.string().uuid().optional(),
    }),
  },
  responses: {
    200: jsonContent(z.any(), 'List of backup schedules'),
    ...standardErrors,
  },
});

backupRoutes.openapi(listSchedulesRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const { serviceId } = c.req.valid('query');
  const schedules = await backupService.listSchedules(accountId, serviceId ?? undefined);
  return c.json(schedules);
}) as any);

// POST /schedules — create backup schedule
const createScheduleSchema = z.object({
  serviceId: z.string().uuid().optional(),
  cron: z.string().min(1).regex(/^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/, 'Invalid cron expression'),
  retentionDays: z.number().int().min(1).max(365).default(30),
  retentionCount: z.number().int().min(1).max(100).default(10),
  storageBackend: z.enum(['nfs', 'local', 'object']).default('nfs'),
  clusterId: z.string().uuid().optional(),
});

const createScheduleRoute = createRoute({
  method: 'post',
  path: '/schedules',
  tags: ['Backups'],
  summary: 'Create a backup schedule',
  security: bearerSecurity,
  request: {
    body: jsonBody(createScheduleSchema),
  },
  responses: {
    201: jsonContent(z.any(), 'Schedule created'),
    ...standardErrors,
  },
  middleware: [backupRateLimit, requireMember],
});

backupRoutes.openapi(createScheduleRoute, (async (c: any) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const data = c.req.valid('json');

  try {
    const schedule = await backupService.createSchedule({
      accountId,
      ...data,
    });

    await schedulerService.onScheduleCreated(schedule.id);

    return c.json(schedule, 201);
  } catch (err) {
    logger.error({ err }, 'Schedule creation failed');
    return c.json({ error: 'Failed to create schedule' }, 500);
  }
}) as any);

// PATCH /schedules/:id — update backup schedule
const updateScheduleSchema = z.object({
  cron: z.string().min(1).regex(/^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/, 'Invalid cron expression').optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
  retentionCount: z.number().int().min(1).max(100).optional(),
  storageBackend: z.enum(['nfs', 'local', 'object']).optional(),
  clusterId: z.string().uuid().nullable().optional(),
  enabled: z.boolean().optional(),
});

const updateScheduleRoute = createRoute({
  method: 'patch',
  path: '/schedules/{id}',
  tags: ['Backups'],
  summary: 'Update a backup schedule',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
    body: jsonBody(updateScheduleSchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Schedule updated'),
    ...standardErrors,
  },
  middleware: [requireMember],
});

backupRoutes.openapi(updateScheduleRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: scheduleId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const data = c.req.valid('json');

  const updated = await backupService.updateSchedule(
    scheduleId,
    accountId,
    data,
  );

  if (!updated) {
    return c.json({ error: 'Schedule not found' }, 404);
  }

  await schedulerService.onScheduleUpdated(scheduleId);

  return c.json(updated);
}) as any);

// DELETE /schedules/:id — delete backup schedule
const deleteScheduleRoute = createRoute({
  method: 'delete',
  path: '/schedules/{id}',
  tags: ['Backups'],
  summary: 'Delete a backup schedule',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Schedule deleted'),
    ...standardErrors,
  },
  middleware: [requireMember],
});

backupRoutes.openapi(deleteScheduleRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: scheduleId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const deleted = await backupService.deleteSchedule(scheduleId, accountId);

  if (!deleted) {
    return c.json({ error: 'Schedule not found' }, 404);
  }

  schedulerService.onScheduleDeleted(scheduleId);

  return c.json({ message: 'Schedule deleted' });
}) as any);

// POST /schedules/:id/run — manually trigger a scheduled backup
const runScheduleRoute = createRoute({
  method: 'post',
  path: '/schedules/{id}/run',
  tags: ['Backups'],
  summary: 'Manually trigger a scheduled backup',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    201: jsonContent(z.object({
      id: z.string(),
      status: z.string(),
      storagePath: z.string().nullable(),
      sizeBytes: z.string(),
    }), 'Backup triggered'),
    ...standardErrors,
  },
  middleware: [requireMember],
});

backupRoutes.openapi(runScheduleRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: scheduleId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  try {
    const backup = await backupService.runScheduledBackup(scheduleId, accountId);
    return c.json({
      id: backup.id,
      status: backup.status,
      storagePath: backup.storagePath,
      sizeBytes: backup.sizeBytes.toString(),
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';

    if (message.includes('not found')) {
      return c.json({ error: 'Backup schedule not found' }, 404);
    }

    logger.error({ err }, 'Scheduled backup trigger failed');
    return c.json({ error: 'Failed to trigger backup' }, 500);
  }
}) as any);

// GET /:id — backup details
const getBackupRoute = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Backups'],
  summary: 'Get backup details',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonContent(z.any(), 'Backup details'),
    ...standardErrors,
  },
});

backupRoutes.openapi(getBackupRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: backupId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const backup = await backupService.getBackup(backupId, accountId);

  if (!backup) {
    return c.json({ error: 'Backup not found' }, 404);
  }

  return c.json({
    ...backup,
    sizeBytes: backup.sizeBytes?.toString() ?? '0',
  });
}) as any);

// DELETE /:id — delete backup
const deleteBackupRoute = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Backups'],
  summary: 'Delete a backup',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonContent(messageResponseSchema, 'Backup deleted'),
    ...standardErrors,
  },
  middleware: [requireMember],
});

backupRoutes.openapi(deleteBackupRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: backupId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Verify ownership
  const backup = await backupService.getBackup(backupId, accountId);
  if (!backup) {
    return c.json({ error: 'Backup not found' }, 404);
  }

  const deleted = await backupService.deleteBackup(backupId, accountId);

  if (!deleted) {
    return c.json({ error: 'Failed to delete backup' }, 500);
  }

  eventService.log({
    ...eventContext(c),
    eventType: EventTypes.BACKUP_DELETED,
    description: `Deleted backup`,
    resourceType: 'backup',
    resourceId: backupId,
  });

  return c.json({ message: 'Backup deleted' });
}) as any);

// POST /:id/restore — restore from backup
const restoreBackupRoute = createRoute({
  method: 'post',
  path: '/{id}/restore',
  tags: ['Backups'],
  summary: 'Restore from a backup',
  security: bearerSecurity,
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonContent(z.any(), 'Backup restored'),
    ...standardErrors,
  },
  middleware: [requireMember],
});

backupRoutes.openapi(restoreBackupRoute, (async (c: any) => {
  const accountId = c.get('accountId');
  const { id: backupId } = c.req.valid('param');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  // Verify ownership
  const backup = await backupService.getBackup(backupId, accountId);
  if (!backup) {
    return c.json({ error: 'Backup not found' }, 404);
  }

  try {
    const result = await backupService.restoreBackup(backupId, accountId);

    eventService.log({
      ...eventContext(c),
      eventType: EventTypes.BACKUP_RESTORED,
      description: `Restored backup`,
      resourceType: 'backup',
      resourceId: backupId,
    });

    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';

    if (message.includes('not found')) {
      return c.json({ error: 'Backup not found' }, 404);
    }
    if (message.includes('Cannot restore')) {
      return c.json({ error: 'Backup cannot be restored in its current state' }, 400);
    }

    logger.error({ err }, 'Backup restore failed');
    return c.json({ error: 'Failed to restore backup' }, 500);
  }
}) as any);

export default backupRoutes;
