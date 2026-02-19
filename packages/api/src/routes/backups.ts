import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { tenantMiddleware, type AccountContext } from '../middleware/tenant.js';
import { backupService } from '../services/backup.service.js';
import { schedulerService } from '../services/scheduler.service.js';
import { requireMember } from '../middleware/rbac.js';
import { logger } from '../services/logger.js';
import { rateLimiter } from '../middleware/rate-limit.js';
import { eventService, EventTypes, eventContext } from '../services/event.service.js';

const backupRateLimit = rateLimiter({ windowMs: 15 * 60 * 1000, max: 10, keyPrefix: 'backup' });

const backupRoutes = new Hono<{
  Variables: {
    user: AuthUser;
    account: AccountContext | null;
    accountId: string | null;
  };
}>();

backupRoutes.use('*', authMiddleware);
backupRoutes.use('*', tenantMiddleware);

// GET / — list backups for account
backupRoutes.get('/', async (c) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const serviceId = c.req.query('serviceId');

  const result = await backupService.listBackups(
    accountId,
    serviceId ?? undefined,
  );

  return c.json(result);
});

// POST / — create manual backup
const createBackupSchema = z.object({
  serviceId: z.string().uuid().optional(),
  storageBackend: z.enum(['nfs', 'local']).default('nfs'),
});

backupRoutes.post('/', backupRateLimit, requireMember, async (c) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = createBackupSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  try {
    const backup = await backupService.createBackup(
      accountId,
      parsed.data.serviceId,
      parsed.data.storageBackend,
    );

    eventService.log({
      ...eventContext(c),
      eventType: EventTypes.BACKUP_CREATED,
      description: `Created backup for '${parsed.data.serviceId ?? 'account'}'`,
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
    logger.error({ err }, 'Backup creation failed');
    return c.json({ error: 'Failed to create backup' }, 500);
  }
});

// GET /schedules — list backup schedules (placed before /:id to avoid conflict)
backupRoutes.get('/schedules', async (c) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const serviceId = c.req.query('serviceId');
  const schedules = await backupService.listSchedules(accountId, serviceId ?? undefined);
  return c.json(schedules);
});

// POST /schedules — create backup schedule
const createScheduleSchema = z.object({
  serviceId: z.string().uuid().optional(),
  cron: z.string().min(1).regex(/^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/, 'Invalid cron expression'),
  retentionDays: z.number().int().min(1).max(365).default(30),
  retentionCount: z.number().int().min(1).max(100).default(10),
  storageBackend: z.enum(['nfs', 'local']).default('nfs'),
});

backupRoutes.post('/schedules', backupRateLimit, requireMember, async (c) => {
  const accountId = c.get('accountId');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = createScheduleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  try {
    const schedule = await backupService.createSchedule({
      accountId,
      ...parsed.data,
    });

    await schedulerService.onScheduleCreated(schedule.id);

    return c.json(schedule, 201);
  } catch (err) {
    logger.error({ err }, 'Schedule creation failed');
    return c.json({ error: 'Failed to create schedule' }, 500);
  }
});

// PATCH /schedules/:id — update backup schedule
const updateScheduleSchema = z.object({
  cron: z.string().min(1).regex(/^(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)\s+(\*|[0-9,\-\/]+)$/, 'Invalid cron expression').optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
  retentionCount: z.number().int().min(1).max(100).optional(),
  storageBackend: z.enum(['nfs', 'local']).optional(),
  enabled: z.boolean().optional(),
});

backupRoutes.patch('/schedules/:id', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const scheduleId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const body = await c.req.json();
  const parsed = updateScheduleSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: 'Validation failed' }, 400);
  }

  const updated = await backupService.updateSchedule(
    scheduleId,
    accountId,
    parsed.data,
  );

  if (!updated) {
    return c.json({ error: 'Schedule not found' }, 404);
  }

  await schedulerService.onScheduleUpdated(scheduleId);

  return c.json(updated);
});

// DELETE /schedules/:id — delete backup schedule
backupRoutes.delete('/schedules/:id', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const scheduleId = c.req.param('id');

  if (!accountId) {
    return c.json({ error: 'Account context required' }, 400);
  }

  const deleted = await backupService.deleteSchedule(scheduleId, accountId);

  if (!deleted) {
    return c.json({ error: 'Schedule not found' }, 404);
  }

  schedulerService.onScheduleDeleted(scheduleId);

  return c.json({ message: 'Schedule deleted' });
});

// POST /schedules/:id/run — manually trigger a scheduled backup
backupRoutes.post('/schedules/:id/run', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const scheduleId = c.req.param('id');

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
});

// GET /:id — backup details
backupRoutes.get('/:id', async (c) => {
  const accountId = c.get('accountId');
  const backupId = c.req.param('id');

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
});

// DELETE /:id — delete backup
backupRoutes.delete('/:id', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const backupId = c.req.param('id');

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
});

// POST /:id/restore — restore from backup
backupRoutes.post('/:id/restore', requireMember, async (c) => {
  const accountId = c.get('accountId');
  const backupId = c.req.param('id');

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
});

export default backupRoutes;
