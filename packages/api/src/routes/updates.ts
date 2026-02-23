import { Hono } from 'hono';
import { z } from 'zod';
import { db, platformSettings, upsert, eq } from '@fleet/db';
import { authMiddleware, type AuthUser } from '../middleware/auth.js';
import { updateService } from '../services/update.service.js';
import { runMigrations, verifyDatabase } from '@fleet/db/migrate';
import { runSeeders } from '@fleet/db/seed';
import { logger } from '../services/logger.js';

const updateRoutes = new Hono<{
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

// GET /notification — lightweight endpoint for the dashboard to poll
// Returns cached update availability (no GitHub API call).
// The admin dashboard should poll this every ~60s and show a badge
// when available === true.
updateRoutes.get('/notification', (c) => {
  return c.json(updateService.getNotification());
});

// GET /check — force-check for available updates (hits GitHub API)
updateRoutes.get('/check', async (c) => {
  // Check if RC releases are enabled in platform settings
  let includePrerelease = c.req.query('prerelease') === 'true';

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
    return c.json({ error: `Failed to check for updates: ${String(err)}` }, 500);
  }
});

// GET /releases — list available releases
updateRoutes.get('/releases', async (c) => {
  const limit = Math.min(Math.max(1, parseInt(c.req.query('limit') ?? '10', 10) || 10), 50);

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
      : releases.filter((r) => !r.prerelease);

    return c.json({
      releases: filtered,
      rcEnabled: includeRc,
    });
  } catch (err) {
    return c.json({ error: `Failed to fetch releases: ${String(err)}` }, 500);
  }
});

// PATCH /settings — update update-related settings (RC toggle, auto-check, backup)
updateRoutes.patch('/settings', async (c) => {
  const schema = z.object({
    includeRcReleases: z.boolean().optional(),
    autoCheckEnabled: z.boolean().optional(),
    backupBeforeUpdate: z.boolean().optional(),
  });

  const body = await c.req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'Invalid settings' }, 400);
  }

  const updates: Record<string, unknown> = {};

  if (parsed.data.includeRcReleases !== undefined) {
    await upsert(
      platformSettings,
      { key: 'updates:includeRcReleases', value: parsed.data.includeRcReleases },
      platformSettings.key,
      { value: parsed.data.includeRcReleases, updatedAt: new Date() },
    );
    updates.includeRcReleases = parsed.data.includeRcReleases;
  }

  if (parsed.data.autoCheckEnabled !== undefined) {
    await upsert(
      platformSettings,
      { key: 'updates:autoCheckEnabled', value: parsed.data.autoCheckEnabled },
      platformSettings.key,
      { value: parsed.data.autoCheckEnabled, updatedAt: new Date() },
    );

    if (parsed.data.autoCheckEnabled) {
      updateService.startPeriodicCheck();
    } else {
      updateService.stopPeriodicCheck();
    }
    updates.autoCheckEnabled = parsed.data.autoCheckEnabled;
  }

  if (parsed.data.backupBeforeUpdate !== undefined) {
    await upsert(
      platformSettings,
      { key: 'updates:backupBeforeUpdate', value: parsed.data.backupBeforeUpdate },
      platformSettings.key,
      { value: parsed.data.backupBeforeUpdate, updatedAt: new Date() },
    );
    updates.backupBeforeUpdate = parsed.data.backupBeforeUpdate;
  }

  return c.json({ message: 'Update settings saved', ...updates });
});

// GET /settings — get current update settings
updateRoutes.get('/settings', async (c) => {
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
});

// GET /status — current update/rollback state
// With multiple API replicas, the update runs on only one instance.
// If this replica's local state is idle, check the DB-persisted state
// in case another replica is actively running an update.
updateRoutes.get('/status', async (c) => {
  const localState = updateService.getState();

  if (localState.status !== 'idle') {
    return c.json(localState);
  }

  // Check if another replica is running an update (persisted state in DB)
  try {
    const { UpdateService } = await import('../services/update.service.js');
    const persisted = await UpdateService.loadPersistedState();
    if (persisted && persisted.status !== 'idle') {
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
});

// POST /perform — start a platform update (zero-downtime rolling update)
updateRoutes.post('/perform', async (c) => {
  const schema = z.object({
    version: z.string().min(1),
    skipBackup: z.boolean().optional().default(false),
  });

  const body = await c.req.json();
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'version is required' }, 400);
  }

  const { version, skipBackup: skipBackupParam } = parsed.data;

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
    .catch((err) => {
      logger.error({ err }, 'Update failed');
    });

  return c.json({
    message: `Update to ${version} started. Poll GET /api/v1/updates/status for progress.`,
    status: 'started',
  }, 202);
});

// POST /rollback — roll back to the previous version
updateRoutes.post('/rollback', async (c) => {
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
    .catch((err) => {
      logger.error({ err }, 'Rollback failed');
    });

  return c.json({
    message: 'Rollback started. Poll GET /api/v1/updates/status for progress.',
    status: 'rolling-back',
  }, 202);
});

// POST /migrate — run database migrations only (without full update)
updateRoutes.post('/migrate', async (c) => {
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
    return c.json({ error: `Migration failed (rolled back): ${String(err)}` }, 500);
  }
});

// POST /seed — run database seeders only (without full update)
updateRoutes.post('/seed', async (c) => {
  try {
    const result = await runSeeders();
    return c.json({
      message: `Seeders completed. ${result.executed} seeder(s) executed.`,
      executed: result.executed,
    });
  } catch (err) {
    return c.json({ error: `Seeder failed: ${String(err)}` }, 500);
  }
});

// POST /reset — force-reset a stuck update state and release the lock
updateRoutes.post('/reset', async (c) => {
  const state = updateService.getState();

  // Only allow reset when in a non-terminal state (stuck) or failed
  const allowedStates = ['failed', 'checking', 'backing-up', 'pulling', 'verifying-images', 'migrating', 'updating', 'seeding', 'verifying', 'rolling-back'];
  if (!allowedStates.includes(state.status)) {
    return c.json({
      error: `System is currently "${state.status}" — no reset needed. Reset is for stuck or failed states.`,
      currentStatus: state.status,
    }, 400);
  }

  const result = await updateService.forceReset();
  logger.warn({ previousStatus: result.previousStatus, user: c.get('user').userId }, 'Update state force-reset by admin');

  return c.json({
    message: `Update state reset successfully. Previous status was "${result.previousStatus}".`,
    previousStatus: result.previousStatus,
    currentStatus: 'idle',
  });
});

// GET /db-status — verify database connectivity
updateRoutes.get('/db-status', async (c) => {
  const result = await verifyDatabase();
  return c.json(result, result.ok ? 200 : 500);
});

export default updateRoutes;
