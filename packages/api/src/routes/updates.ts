import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import { db, platformSettings, upsert, eq } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { updateService } from '../services/update.service.js';
import { runMigrations, verifyDatabase } from '@fleet/db/migrate';
import { runSeeders } from '@fleet/db/seed';
import { logger, logToErrorTable } from '../services/logger.js';
import { jsonBody, jsonContent, errorResponseSchema, messageResponseSchema, standardErrors, bearerSecurity } from './_schemas.js';

const updateRoutes = new OpenAPIHono<{
  Variables: { user: AuthUser };
}>();

updateRoutes.use('*', authMiddleware);

// Super user guard — only super admins can manage platform updates
updateRoutes.use('*', async (c, next) => {
  const user = c.get('user');
  if (!user.isSuper) {
    return c.json({ error: 'Super user access required' }, 403);
  }
  await next();
});

// ── Response schemas ──

const notificationResponseSchema = z.any().openapi('UpdateNotification');

const checkResponseSchema = z.any().openapi('UpdateCheckResult');

const releasesResponseSchema = z.object({
  releases: z.array(z.any()),
  rcEnabled: z.boolean(),
}).openapi('ReleasesResponse');

const updateSettingsSchema = z.object({
  includeRcReleases: z.boolean(),
  autoCheckEnabled: z.boolean(),
  backupBeforeUpdate: z.boolean(),
}).openapi('UpdateSettings');

const updateStatusSchema = z.any().openapi('UpdateStatus');

const dbStatusSchema = z.object({
  ok: z.boolean(),
  error: z.string().optional(),
}).openapi('DbStatus');

// ── Request schemas ──

const patchSettingsBodySchema = z.object({
  includeRcReleases: z.boolean().optional(),
  autoCheckEnabled: z.boolean().optional(),
  backupBeforeUpdate: z.boolean().optional(),
}).openapi('PatchUpdateSettings');

const performUpdateBodySchema = z.object({
  version: z.string().min(1),
  skipBackup: z.boolean().optional().default(false),
}).openapi('PerformUpdate');

// ── Route definitions ──

const notificationRoute = createRoute({
  method: 'get',
  path: '/notification',
  tags: ['Updates'],
  summary: 'Poll for update availability (cached, no GitHub API call)',
  security: bearerSecurity,
  responses: {
    200: jsonContent(notificationResponseSchema, 'Update notification status'),
    ...standardErrors,
  },
});

const checkRoute = createRoute({
  method: 'get',
  path: '/check',
  tags: ['Updates'],
  summary: 'Force-check for available updates (hits GitHub API)',
  security: bearerSecurity,
  request: {
    query: z.object({
      prerelease: z.string().optional(),
    }),
  },
  responses: {
    200: jsonContent(checkResponseSchema, 'Update check result'),
    ...standardErrors,
  },
});

const releasesRoute = createRoute({
  method: 'get',
  path: '/releases',
  tags: ['Updates'],
  summary: 'List available releases',
  security: bearerSecurity,
  request: {
    query: z.object({
      limit: z.string().optional(),
    }),
  },
  responses: {
    200: jsonContent(releasesResponseSchema, 'Available releases'),
    ...standardErrors,
  },
});

const patchSettingsRoute = createRoute({
  method: 'patch',
  path: '/settings',
  tags: ['Updates'],
  summary: 'Update update-related settings',
  security: bearerSecurity,
  request: {
    body: jsonBody(patchSettingsBodySchema),
  },
  responses: {
    200: jsonContent(z.any(), 'Settings saved'),
    ...standardErrors,
  },
});

const getSettingsRoute = createRoute({
  method: 'get',
  path: '/settings',
  tags: ['Updates'],
  summary: 'Get current update settings',
  security: bearerSecurity,
  responses: {
    200: jsonContent(updateSettingsSchema, 'Current update settings'),
    ...standardErrors,
  },
});

const statusRoute = createRoute({
  method: 'get',
  path: '/status',
  tags: ['Updates'],
  summary: 'Get current update/rollback state',
  security: bearerSecurity,
  responses: {
    200: jsonContent(updateStatusSchema, 'Current update status'),
    ...standardErrors,
  },
});

const performRoute = createRoute({
  method: 'post',
  path: '/perform',
  tags: ['Updates'],
  summary: 'Start a platform update (zero-downtime rolling update)',
  security: bearerSecurity,
  request: {
    body: jsonBody(performUpdateBodySchema),
  },
  responses: {
    ...standardErrors,
    202: jsonContent(z.object({
      message: z.string(),
      status: z.string(),
    }), 'Update started'),
  },
});

const rollbackRoute = createRoute({
  method: 'post',
  path: '/rollback',
  tags: ['Updates'],
  summary: 'Roll back to the previous version',
  security: bearerSecurity,
  responses: {
    ...standardErrors,
    202: jsonContent(z.object({
      message: z.string(),
      status: z.string(),
    }), 'Rollback started'),
    409: jsonContent(errorResponseSchema, 'Cannot rollback in current state'),
  },
});

const migrateRoute = createRoute({
  method: 'post',
  path: '/migrate',
  tags: ['Updates'],
  summary: 'Run database migrations only (without full update)',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      message: z.string(),
      applied: z.number(),
    }), 'Migrations completed'),
    ...standardErrors,
  },
});

const seedRoute = createRoute({
  method: 'post',
  path: '/seed',
  tags: ['Updates'],
  summary: 'Run database seeders only (without full update)',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      message: z.string(),
      executed: z.number(),
    }), 'Seeders completed'),
    ...standardErrors,
  },
});

const resetRoute = createRoute({
  method: 'post',
  path: '/reset',
  tags: ['Updates'],
  summary: 'Force-reset a stuck update state and release the lock',
  security: bearerSecurity,
  responses: {
    200: jsonContent(z.object({
      message: z.string(),
      previousStatus: z.string(),
      currentStatus: z.string(),
    }), 'State reset successfully'),
    ...standardErrors,
  },
});

const dbStatusRoute = createRoute({
  method: 'get',
  path: '/db-status',
  tags: ['Updates'],
  summary: 'Verify database connectivity',
  security: bearerSecurity,
  responses: {
    200: jsonContent(dbStatusSchema, 'Database is reachable'),
    ...standardErrors,
  },
});

// ── Route handlers ──

// GET /notification — lightweight endpoint for the dashboard to poll
// Returns cached update availability (no GitHub API call).
// The admin dashboard should poll this every ~60s and show a badge
// when available === true.
updateRoutes.openapi(notificationRoute, (async (c: any) => {
  return c.json(updateService.getNotification());
}) as any);

// GET /check — force-check for available updates (hits GitHub API)
updateRoutes.openapi(checkRoute, (async (c: any) => {
  // Check if RC releases are enabled in platform settings
  let includePrerelease = c.req.valid('query').prerelease === 'true';

  if (!includePrerelease) {
    try {
      const rcSetting = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, 'updates:includeRcReleases'),
      });
      if (rcSetting?.value === true) {
        includePrerelease = true;
      }
    } catch {
      // Ignore — default to stable only
    }
  }

  try {
    const result = await updateService.checkForUpdates(includePrerelease);
    return c.json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to check for updates');
    logToErrorTable({ level: 'error', message: `Failed to check for updates: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'updates/settings', operation: 'check-updates' } });
    return c.json({ error: `Failed to check for updates: ${String(err)}` }, 500);
  }
}) as any);

// GET /releases — list available releases
updateRoutes.openapi(releasesRoute, (async (c: any) => {
  const limit = Math.min(Math.max(1, parseInt(c.req.valid('query').limit ?? '10', 10) || 10), 50);

  try {
    const releases = await updateService.listReleases(limit);

    // Check if RC is enabled
    let includeRc = false;
    try {
      const rcSetting = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, 'updates:includeRcReleases'),
      });
      includeRc = rcSetting?.value === true;
    } catch { /* ignore */ }

    // Filter out pre-releases unless RC is enabled
    const filtered = includeRc
      ? releases
      : releases.filter((r: any) => !r.prerelease);

    return c.json({
      releases: filtered,
      rcEnabled: includeRc,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to fetch releases');
    logToErrorTable({ level: 'error', message: `Failed to fetch releases: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'updates/settings', operation: 'list-releases' } });
    return c.json({ error: `Failed to fetch releases: ${String(err)}` }, 500);
  }
}) as any);

// PATCH /settings — update update-related settings (RC toggle, auto-check, backup)
updateRoutes.openapi(patchSettingsRoute, (async (c: any) => {
  const parsed = c.req.valid('json');

  const updates: Record<string, unknown> = {};

  if (parsed.includeRcReleases !== undefined) {
    await upsert(
      platformSettings,
      { key: 'updates:includeRcReleases', value: parsed.includeRcReleases },
      platformSettings.key,
      { value: parsed.includeRcReleases, updatedAt: new Date() },
    );
    updates.includeRcReleases = parsed.includeRcReleases;
  }

  if (parsed.autoCheckEnabled !== undefined) {
    await upsert(
      platformSettings,
      { key: 'updates:autoCheckEnabled', value: parsed.autoCheckEnabled },
      platformSettings.key,
      { value: parsed.autoCheckEnabled, updatedAt: new Date() },
    );

    if (parsed.autoCheckEnabled) {
      updateService.startPeriodicCheck();
    } else {
      updateService.stopPeriodicCheck();
    }
    updates.autoCheckEnabled = parsed.autoCheckEnabled;
  }

  if (parsed.backupBeforeUpdate !== undefined) {
    await upsert(
      platformSettings,
      { key: 'updates:backupBeforeUpdate', value: parsed.backupBeforeUpdate },
      platformSettings.key,
      { value: parsed.backupBeforeUpdate, updatedAt: new Date() },
    );
    updates.backupBeforeUpdate = parsed.backupBeforeUpdate;
  }

  return c.json({ message: 'Update settings saved', ...updates });
}) as any);

// GET /settings — get current update settings
updateRoutes.openapi(getSettingsRoute, (async (c: any) => {
  const rcSetting = await db.query.platformSettings.findFirst({
    where: eq(platformSettings.key, 'updates:includeRcReleases'),
  });
  const autoCheckSetting = await db.query.platformSettings.findFirst({
    where: eq(platformSettings.key, 'updates:autoCheckEnabled'),
  });
  const backupSetting = await db.query.platformSettings.findFirst({
    where: eq(platformSettings.key, 'updates:backupBeforeUpdate'),
  });

  return c.json({
    includeRcReleases: rcSetting?.value === true,
    autoCheckEnabled: autoCheckSetting?.value !== false, // default true
    backupBeforeUpdate: backupSetting?.value !== false, // default true
  });
}) as any);

// GET /status — current update/rollback state
// With multiple API replicas, the update runs on only one instance.
// If this replica's local state is idle, check the DB-persisted state
// in case another replica is actively running an update.
updateRoutes.openapi(statusRoute, (async (c: any) => {
  const localState = updateService.getState();

  if (localState.status !== 'idle') {
    return c.json(localState);
  }

  // Check if another replica is running an update (persisted state in DB)
  try {
    const { UpdateService } = await import('../services/update.service.js');
    const persisted = await UpdateService.loadPersistedState();
    if (persisted && persisted.status !== 'idle') {
      // Auto-clear stale persisted state that's been stuck for over 30 minutes
      const startedAt = persisted.startedAt ? new Date(persisted.startedAt).getTime() : 0;
      const staleMs = 30 * 60 * 1000;
      if (startedAt > 0 && Date.now() - startedAt > staleMs) {
        logger.warn({ persistedStatus: persisted.status, startedAt: persisted.startedAt }, 'Auto-clearing stale persisted update state (>30 min old)');
        await updateService.forceReset();
        return c.json(updateService.getState());
      }

      const hasSnapshot = Object.keys(persisted.previousImageTags ?? {}).length > 0;
      const allowedForRollback = ['idle', 'completed', 'failed'].includes(persisted.status);
      let rollbackTarget: string | null = null;
      if (hasSnapshot) {
        const firstImage = Object.values(persisted.previousImageTags)[0] ?? '';
        const tagMatch = (firstImage as string).match(/:([^@]+)/);
        if (tagMatch) rollbackTarget = tagMatch[1]!;
      }
      return c.json({
        status: persisted.status,
        currentVersion: persisted.currentVersion,
        targetVersion: persisted.targetVersion,
        log: persisted.log,
        startedAt: persisted.startedAt,
        finishedAt: persisted.finishedAt,
        previousImageTags: persisted.previousImageTags,
        preUpdateBackupId: persisted.preUpdateBackupId,
        servicesUpdated: persisted.servicesUpdated,
        canRollback: hasSnapshot && allowedForRollback,
        rollbackTarget,
      });
    }
  } catch {
    // DB read failed — return local state
  }

  return c.json(localState);
}) as any);

// POST /perform — start a platform update (zero-downtime rolling update)
updateRoutes.openapi(performRoute, (async (c: any) => {
  const { version, skipBackup: skipBackupParam } = c.req.valid('json');

  // Resolve skipBackup: explicit request param > platform setting > default (false)
  let skipBackup = skipBackupParam;
  if (!skipBackup) {
    try {
      const backupSetting = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, 'updates:backupBeforeUpdate'),
      });
      // If the setting is explicitly false, skip backup
      if (backupSetting?.value === false) {
        skipBackup = true;
      }
    } catch { /* default to not skipping */ }
  }

  // Pre-flight: verify database is accessible
  const dbCheck = await verifyDatabase();
  if (!dbCheck.ok) {
    return c.json({ error: `Database pre-flight failed: ${dbCheck.error}` }, 500);
  }

  // Start the update in the background — return immediately
  // The client polls GET /status for progress
  updateService
    .performUpdate(
      version,
      () => runMigrations(),
      () => runSeeders(),
      { skipBackup },
    )
    .catch((err: any) => {
      logger.error({ err }, 'Update failed');
    });

  return c.json({
    message: `Update to ${version} started. Poll GET /api/v1/updates/status for progress.`,
    status: 'started',
  }, 202);
}) as any);

// POST /rollback — roll back to the previous version
updateRoutes.openapi(rollbackRoute, (async (c: any) => {
  const state = updateService.getState();

  if (state.status !== 'idle' && state.status !== 'failed' && state.status !== 'completed') {
    return c.json({
      error: `Cannot rollback while system is in "${state.status}" state. Wait for the current operation to finish.`,
    }, 409);
  }

  if (Object.keys(state.previousImageTags).length === 0) {
    return c.json({
      error: 'No previous version snapshot available. Rollback is only possible after a failed or completed update.',
    }, 400);
  }

  // Start rollback in the background
  updateService
    .rollback()
    .catch((err: any) => {
      logger.error({ err }, 'Rollback failed');
    });

  return c.json({
    message: 'Rollback started. Poll GET /api/v1/updates/status for progress.',
    status: 'rolling-back',
  }, 202);
}) as any);

// POST /migrate — run database migrations only (without full update)
updateRoutes.openapi(migrateRoute, (async (c: any) => {
  const dbCheck = await verifyDatabase();
  if (!dbCheck.ok) {
    return c.json({ error: `Database pre-flight failed: ${dbCheck.error}` }, 500);
  }

  try {
    const result = await runMigrations();
    return c.json({
      message: `Migrations completed successfully. ${result.applied} migration(s) applied.`,
      applied: result.applied,
    });
  } catch (err) {
    logger.error({ err }, 'Migration failed');
    logToErrorTable({ level: 'error', message: `Migration failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'updates/settings', operation: 'run-migrations' } });
    return c.json({ error: `Migration failed (rolled back): ${String(err)}` }, 500);
  }
}) as any);

// POST /seed — run database seeders only (without full update)
updateRoutes.openapi(seedRoute, (async (c: any) => {
  try {
    const result = await runSeeders();
    return c.json({
      message: `Seeders completed. ${result.executed} seeder(s) executed.`,
      executed: result.executed,
    });
  } catch (err) {
    logger.error({ err }, 'Seeder failed');
    logToErrorTable({ level: 'error', message: `Seeder failed: ${err instanceof Error ? err.message : String(err)}`, stack: err instanceof Error ? err.stack : null, metadata: { context: 'updates/settings', operation: 'run-seeders' } });
    return c.json({ error: `Seeder failed: ${String(err)}` }, 500);
  }
}) as any);

// POST /reset — force-reset a stuck update state and release the lock
updateRoutes.openapi(resetRoute, (async (c: any) => {
  const state = updateService.getState();

  // Check both in-memory AND DB-persisted state — another replica may have left stale state
  const allowedStates = ['failed', 'checking', 'backing-up', 'pulling', 'verifying-images', 'migrating', 'updating', 'seeding', 'verifying', 'rolling-back'];
  let persistedStatus: string | null = null;

  if (!allowedStates.includes(state.status)) {
    // In-memory is idle/completed — check if DB has stale state from another replica
    try {
      const { UpdateService } = await import('../services/update.service.js');
      const persisted = await UpdateService.loadPersistedState();
      if (persisted && persisted.status !== 'idle') {
        persistedStatus = persisted.status;
      }
    } catch {
      // DB read failed
    }

    if (!persistedStatus) {
      return c.json({
        error: `System is currently "${state.status}" — no reset needed. Reset is for stuck or failed states.`,
        currentStatus: state.status,
      }, 400);
    }
  }

  const result = await updateService.forceReset();
  const effectiveStatus = persistedStatus ?? result.previousStatus;
  logger.warn({ previousStatus: effectiveStatus, user: c.get('user').userId }, 'Update state force-reset by admin');

  return c.json({
    message: `Update state reset successfully. Previous status was "${effectiveStatus}".`,
    previousStatus: effectiveStatus,
    currentStatus: 'idle',
  });
}) as any);

// GET /db-status — verify database connectivity
updateRoutes.openapi(dbStatusRoute, (async (c: any) => {
  const result = await verifyDatabase();
  return c.json(result, result.ok ? 200 : 500);
}) as any);

export default updateRoutes;
