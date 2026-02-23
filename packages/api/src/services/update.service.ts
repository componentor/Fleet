import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { dockerService } from './docker.service.js';
import { backupService } from './backup.service.js';
import { logger } from './logger.js';
import { getValkey } from './valkey.service.js';
import { db, platformSettings, accounts, eq, upsert } from '@fleet/db';

const GITHUB_REPO = process.env['FLEET_GITHUB_REPO'] ?? 'componentor/fleet';
const GITHUB_TOKEN = process.env['GITHUB_TOKEN'] ?? '';
const IMAGE_PREFIX = process.env['FLEET_IMAGE_PREFIX'] ?? 'ghcr.io/componentor';
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const LOCK_KEY = 'system:update_lock';
const STATE_KEY = 'system:update_state';
const LOCK_STALE_MS = 30 * 60 * 1000; // 30 minutes
const MAX_PERSISTED_LOG_LINES = 200;

export type UpdateStatus = 'idle' | 'checking' | 'backing-up' | 'pulling' | 'verifying-images' | 'migrating' | 'updating' | 'seeding' | 'verifying' | 'completed' | 'failed' | 'rolling-back';

export interface ReleaseInfo {
  tag: string;
  name: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  prerelease: boolean;
  checksums: Record<string, string>; // image name → sha256 digest from release body
}

export interface UpdateNotification {
  available: boolean;
  current: string;
  latest: ReleaseInfo | null;
  checkedAt: string;
}

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  targetVersion: string | null;
  log: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  previousImageTags: Map<string, string>;
  preUpdateBackupId: string | null;
  servicesUpdated: string[];
}

/** JSON-serializable shape stored in platformSettings under STATE_KEY */
export interface PersistedUpdateState {
  status: UpdateStatus;
  currentVersion: string;
  targetVersion: string | null;
  log: string;
  startedAt: string | null;
  finishedAt: string | null;
  previousImageTags: Record<string, string>;
  preUpdateBackupId: string | null;
  servicesUpdated: string[];
  fencingToken: number;
}

/** JSON shape stored in platformSettings under LOCK_KEY */
interface LockValue {
  lockedAt: string;
  lockedBy: string;
  fencingToken: number;
}

// fleet_api is LAST so the orchestrating process survives to update all other services first
const FLEET_SERVICES = ['fleet_dashboard', 'fleet_ssh-gateway', 'fleet_agent', 'fleet_api'] as const;

export class UpdateService {
  private state: UpdateState = {
    status: 'idle',
    currentVersion: process.env['FLEET_VERSION'] ?? '0.1.0',
    targetVersion: null,
    log: '',
    startedAt: null,
    finishedAt: null,
    previousImageTags: new Map(),
    preUpdateBackupId: null,
    servicesUpdated: [],
  };

  /** Read persisted version from DB — call once after DB is ready. */
  async initVersion(): Promise<void> {
    try {
      const row = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, 'platform:currentVersion'),
      });
      const persisted = row?.value as string | null;
      if (persisted && typeof persisted === 'string' && persisted !== '') {
        this.state.currentVersion = persisted;
        this.cachedNotification.current = persisted;
        return;
      }
    } catch {
      // DB not ready yet — try Docker fallback
    }

    // Fallback: detect version from running fleet_api image tag
    try {
      const swarmServices = await dockerService.listServices({ name: ['fleet_api'] });
      if (swarmServices.length > 0) {
        const spec = swarmServices[0]!.Spec as { TaskTemplate?: { ContainerSpec?: { Image?: string } } };
        const image = spec?.TaskTemplate?.ContainerSpec?.Image ?? '';
        // Image format: ghcr.io/componentor/fleet-api:0.1.1@sha256:...
        const tagMatch = image.match(/:([0-9]+\.[0-9]+\.[0-9]+[^@]*)/);
        if (tagMatch) {
          const detected = tagMatch[1]!;
          this.state.currentVersion = detected;
          this.cachedNotification.current = detected;
          logger.info({ detected }, 'Detected version from running Docker image');
        }
      }
    } catch {
      // Non-critical — keep env default
    }
  }

  /**
   * Force-reset the update state and release any stuck lock.
   * Used by admins to recover from stuck updates without restarting.
   */
  async forceReset(): Promise<{ previousStatus: string }> {
    const previousStatus = this.state.status;

    // Release the distributed lock regardless of ownership
    try {
      await upsert(
        platformSettings,
        { key: LOCK_KEY, value: {} },
        platformSettings.key,
        { value: {}, updatedAt: new Date() },
      );
    } catch (err) {
      logger.error({ err }, 'Failed to clear update lock during force reset');
    }

    // Clear persisted state
    try {
      await upsert(
        platformSettings,
        { key: STATE_KEY, value: {} },
        platformSettings.key,
        { value: {}, updatedAt: new Date() },
      );
    } catch (err) {
      logger.error({ err }, 'Failed to clear persisted state during force reset');
    }

    // Abort any running performUpdate() so it stops processing
    if (this.updateAbort) {
      this.updateAbort.abort();
      this.updateAbort = null;
    }

    // Reset in-memory state
    this.state.status = 'idle';
    this.state.log = `[${new Date().toISOString()}] State force-reset by admin (was: ${previousStatus})\n`;
    this.state.finishedAt = new Date();
    this.state.previousImageTags.clear();
    this.state.preUpdateBackupId = null;
    this.state.servicesUpdated = [];
    this.fencingToken = 0;

    this.events.emit('update', this.state);
    logger.warn({ previousStatus }, 'Update state force-reset by admin');

    return { previousStatus };
  }

  private fencingToken = 0;
  private events = new EventEmitter();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private updateAbort: AbortController | null = null;

  /** Cached notification for the dashboard to poll without hitting GitHub */
  private cachedNotification: UpdateNotification = {
    available: false,
    current: this.state.currentVersion,
    latest: null,
    checkedAt: new Date().toISOString(),
  };

  // ── Public API ─────────────────────────────────────────────────

  getState(): Omit<UpdateState, 'previousImageTags'> & {
    previousImageTags: Record<string, string>;
    canRollback: boolean;
    rollbackTarget: string | null;
  } {
    const tags = Object.fromEntries(this.state.previousImageTags);
    const hasSnapshot = this.state.previousImageTags.size > 0;
    const allowedForRollback = ['idle', 'completed', 'failed'].includes(this.state.status);
    // Extract the version from the first snapshot image tag (e.g. "ghcr.io/x/fleet-api:0.1.7@sha256:...")
    let rollbackTarget: string | null = null;
    if (hasSnapshot) {
      const firstImage = [...this.state.previousImageTags.values()][0] ?? '';
      const tagMatch = firstImage.match(/:([^@]+)/);
      if (tagMatch) rollbackTarget = tagMatch[1]!;
    }
    return {
      ...this.state,
      previousImageTags: tags,
      canRollback: hasSnapshot && allowedForRollback,
      rollbackTarget,
    };
  }

  /** Returns the cached update notification (no GitHub API call). */
  getNotification(): UpdateNotification {
    return this.cachedNotification;
  }

  onUpdate(callback: (state: UpdateState) => void): () => void {
    this.events.on('update', callback);
    return () => this.events.off('update', callback);
  }

  /**
   * Start a background timer that checks GitHub for new releases every 6 hours.
   * Call this once on API startup.
   */
  startPeriodicCheck() {
    // Check immediately on startup (after a short delay to let the API boot)
    setTimeout(() => {
      this.refreshNotification().catch((err) => {
        logger.error({ err }, 'Periodic update check failed');
      });
    }, 30_000); // 30s after boot

    this.checkTimer = setInterval(() => {
      this.refreshNotification().catch((err) => {
        logger.error({ err }, 'Periodic update check failed');
      });
    }, CHECK_INTERVAL_MS);
  }

  stopPeriodicCheck() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
  }

  /**
   * Called once on API startup (after DB is ready).
   * Detects interrupted updates from a previous crash and attempts recovery.
   */
  async recoverFromInterruptedUpdate(): Promise<void> {
    const persisted = await UpdateService.loadPersistedState();
    if (!persisted) return;

    if (persisted.status === 'idle') {
      await this.clearPersistedState();
      return;
    }

    // Load completed/failed state into memory so the dashboard can display the
    // full log after the API container restarts (fleet_api update kills the old
    // container, new one starts fresh). This preserves the update log for the UI.
    if (persisted.status === 'completed' || persisted.status === 'failed') {
      this.state.status = persisted.status;
      this.state.currentVersion = persisted.currentVersion;
      this.state.targetVersion = persisted.targetVersion;
      this.state.log = persisted.log;
      this.state.startedAt = persisted.startedAt ? new Date(persisted.startedAt) : null;
      this.state.finishedAt = persisted.finishedAt ? new Date(persisted.finishedAt) : null;
      this.state.servicesUpdated = persisted.servicesUpdated;
      this.state.preUpdateBackupId = persisted.preUpdateBackupId;
      // Restore previous image tags so rollback button works after container restart
      this.state.previousImageTags = new Map(Object.entries(persisted.previousImageTags ?? {}));
      this.cachedNotification.current = persisted.currentVersion;
      this.events.emit('update', this.state);
      // Don't clear persisted state yet — keep it until the next update starts
      // so rollback remains available across multiple container restarts.
      // Only clear the lock so the system can accept new updates.
      await this.releaseUpdateLock();
      return;
    }

    // Check if the lock is still actively held (another instance may be handling it)
    try {
      const lockRow = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, LOCK_KEY),
      });
      const lockData = lockRow?.value as LockValue | Record<string, never> | null;
      const isLocked = lockData != null && 'lockedAt' in lockData && lockData.lockedAt != null;
      const isStale = isLocked && (Date.now() - new Date((lockData as LockValue).lockedAt).getTime() > LOCK_STALE_MS);

      if (isLocked && !isStale) {
        logger.info('Found active update lock — another instance may be handling the update. Skipping recovery.');
        return;
      }
    } catch (err) {
      logger.warn({ err }, 'Could not check update lock during recovery — proceeding cautiously');
    }

    logger.warn(
      { status: persisted.status, target: persisted.targetVersion, servicesUpdated: persisted.servicesUpdated },
      'Detected interrupted update — starting recovery',
    );

    // Special case: interrupted during migration — cannot safely auto-recover
    if (persisted.status === 'migrating') {
      logger.error(
        { backupId: persisted.preUpdateBackupId },
        'CRITICAL: Update was interrupted during database migration. ' +
        'Manual inspection required. If the database is corrupted, restore from backup: ' +
        (persisted.preUpdateBackupId ?? 'no backup available'),
      );
      await this.clearPersistedState();
      await this.releaseUpdateLock();
      return;
    }

    // Restore in-memory state from persisted data so rollbackServices can work
    this.state.previousImageTags = new Map(Object.entries(persisted.previousImageTags));
    this.state.preUpdateBackupId = persisted.preUpdateBackupId;
    this.state.targetVersion = persisted.targetVersion;
    this.state.log = persisted.log;
    this.fencingToken = persisted.fencingToken;

    // Roll back any services that were updated before the crash
    if (persisted.servicesUpdated.length > 0) {
      this.state.status = 'rolling-back';
      this.appendLog(`Recovery: rolling back ${persisted.servicesUpdated.length} service(s) updated before crash...`);
      try {
        await this.rollbackServices(persisted.servicesUpdated);
        this.appendLog('Recovery rollback completed successfully.');
      } catch (err) {
        logger.error({ err }, 'Recovery rollback failed — manual intervention may be needed');
        this.appendLog(`Recovery rollback FAILED: ${String(err)}`);
      }
    } else {
      this.appendLog('Recovery: no services were updated before crash — no rollback needed.');
    }

    // Reset to idle
    this.state.status = 'idle';
    this.state.finishedAt = new Date();
    this.state.servicesUpdated = [];
    await this.clearPersistedState();
    await this.releaseUpdateLock();
    logger.info('Update recovery completed — system restored to idle state');
  }

  // ── Check for new releases ────────────────────────────────────

  async checkForUpdates(includePrerelease = false): Promise<UpdateNotification> {
    this.state.status = 'checking';
    this.appendLog('Checking for updates...');

    try {
      const releases = await this.fetchGitHubReleases();
      const candidates = includePrerelease ? releases : releases.filter((r) => !r.prerelease);

      if (candidates.length === 0) {
        this.state.status = 'idle';
        this.cachedNotification = {
          available: false,
          current: this.state.currentVersion,
          latest: null,
          checkedAt: new Date().toISOString(),
        };
        return this.cachedNotification;
      }

      const latest = candidates[0]!;
      const isNewer = this.isNewerVersion(latest.tag, this.state.currentVersion);

      this.state.status = 'idle';
      this.appendLog(`Current: ${this.state.currentVersion}, Latest: ${latest.tag}, Update available: ${isNewer}`);

      this.cachedNotification = {
        available: isNewer,
        current: this.state.currentVersion,
        latest,
        checkedAt: new Date().toISOString(),
      };

      return this.cachedNotification;
    } catch (err) {
      this.state.status = 'idle';
      this.appendLog(`Failed to check for updates: ${String(err)}`);
      throw err;
    }
  }

  async listReleases(limit = 10): Promise<ReleaseInfo[]> {
    return this.fetchGitHubReleases(limit);
  }

  // ── Perform zero-downtime rolling update ───────────────────────

  async performUpdate(
    targetVersion: string,
    runMigrations: () => Promise<{ applied: number }>,
    runSeeders: () => Promise<{ executed: number }>,
    options?: { skipBackup?: boolean },
  ): Promise<void> {
    // Reset state so UI can see what's happening immediately
    this.state.log = '';
    this.state.targetVersion = targetVersion;
    this.state.startedAt = new Date();
    this.state.finishedAt = null;

    if (this.state.status !== 'idle' && this.state.status !== 'completed' && this.state.status !== 'failed') {
      this.state.status = 'failed';
      this.appendLog(`Cannot start update: system is currently ${this.state.status}`);
      this.state.finishedAt = new Date();
      this.events.emit('update', this.state);
      throw new Error(`Cannot start update: system is currently ${this.state.status}`);
    }

    // Create abort controller so forceReset() can cancel this update
    this.updateAbort = new AbortController();
    const { signal } = this.updateAbort;

    // Distributed lock: prevent concurrent updates across API instances
    this.state.status = 'checking';
    this.appendLog('Acquiring update lock...');
    this.events.emit('update', this.state);

    const fencingToken = await this.acquireUpdateLock();
    if (fencingToken === null) {
      this.state.status = 'failed';
      this.appendLog('Another update is already in progress (distributed lock held)');
      this.state.finishedAt = new Date();
      this.events.emit('update', this.state);
      throw new Error('Another update is already in progress (distributed lock held)');
    }

    this.appendLog('Lock acquired.');
    this.state.status = 'backing-up';
    this.state.previousImageTags.clear();
    this.state.preUpdateBackupId = null;
    this.state.servicesUpdated = [];

    const imageTag = targetVersion.startsWith('v') ? targetVersion.slice(1) : targetVersion;
    await this.persistState();

    try {
      // 0. Pre-update backup (controlled by dashboard setting)
      // If the backup fails or times out, the update STOPS. The admin can use
      // Reset to abort and retry, or toggle "Create backup before updating" off in Update Settings.
      if (signal.aborted) throw new Error('Update aborted by admin');
      const skipBackup = options?.skipBackup ?? false;
      if (skipBackup) {
        this.appendLog('Skipping pre-update backup (user opted out).');
      } else {
        this.appendLog('Creating pre-update database backup...');
        await Promise.race([
          (async () => {
            const firstAccount = await db.query.accounts.findFirst();
            if (!firstAccount) throw new Error('No accounts found — cannot create backup');
            const backupAccountId = firstAccount.id;

            let backup: { id: string; status: string; storagePath: string | null; sizeBytes: number };
            try {
              backup = await backupService.createBackup(backupAccountId, undefined, 'nfs');
            } catch {
              this.appendLog('NFS backup unavailable — falling back to local backup...');
              backup = await backupService.createBackup(backupAccountId, undefined, 'local');
            }
            this.state.preUpdateBackupId = backup.id;
            this.appendLog(`Pre-update backup queued: ${backup.id}`);

            this.appendLog('Waiting for backup to complete...');
            await this.waitForBackupCompletion(backup.id, 60_000);
            this.appendLog('Pre-update backup verified as completed.');
          })(),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Backup timed out after 90s — backup worker may be unresponsive. Use Reset and check backup system.')), 90_000),
          ),
          new Promise<never>((_, reject) => {
            signal.addEventListener('abort', () => reject(new Error('Update aborted by admin')), { once: true });
          }),
        ]);
      }

      // 1. Snapshot current image tags (with digests) for rollback
      if (signal.aborted) throw new Error('Update aborted by admin');
      this.state.status = 'pulling';
      this.appendLog('Snapshotting current service images for rollback...');
      await this.snapshotCurrentImages();
      await this.persistState();

      // Verify all services were snapshotted
      if (this.state.previousImageTags.size < FLEET_SERVICES.length) {
        const missing = FLEET_SERVICES.filter((s) => !this.state.previousImageTags.has(s));
        this.appendLog(`Warning: Could not snapshot all services. Missing: ${missing.join(', ')}`);
        if (process.env['NODE_ENV'] === 'production') {
          throw new Error(`Cannot proceed — failed to snapshot services for rollback: ${missing.join(', ')}`);
        }
      }

      // 2. Fetch release checksums from the release body
      this.appendLog('Fetching release checksums...');
      const release = await this.fetchRelease(targetVersion);
      const expectedChecksums = release?.checksums ?? {};

      // 3. Validate checksums are present (required for production)
      this.state.status = 'verifying-images';
      await this.persistState();
      const hasChecksums = Object.keys(expectedChecksums).length > 0;
      if (!hasChecksums) {
        const requireVerify = process.env['REQUIRE_UPDATE_DIGEST_VERIFICATION'] === '1';
        if (requireVerify) {
          throw new Error(
            'Release has no checksums — image integrity cannot be verified. ' +
            'Add a "## Checksums" section to release notes, or unset REQUIRE_UPDATE_DIGEST_VERIFICATION to bypass.'
          );
        } else {
          this.appendLog('No checksums in release notes — digest verification will be skipped.');
        }
      } else {
        this.appendLog(`Found checksums for ${Object.keys(expectedChecksums).length} image(s) — will verify after each service update.`);
      }

      // 4. Run database migrations (transactional + advisory-locked)
      if (signal.aborted) throw new Error('Update aborted by admin');
      this.state.status = 'migrating';
      await this.persistState();
      this.appendLog('Running database migrations (transactional)...');
      try {
        const result = await runMigrations();
        this.appendLog(`Migrations completed: ${result.applied} migration(s) applied.`);
      } catch (err) {
        this.appendLog(`Migration FAILED (rolled back): ${String(err)}`);
        throw new Error(`Migration failed — database was NOT modified: ${String(err)}`);
      }

      // 5. Verify database health after migrations, before updating services
      this.appendLog('Verifying database health post-migration...');
      const { verifyDatabase } = await import('@fleet/db/migrate');
      const dbHealth = await verifyDatabase();
      if (!dbHealth.ok) {
        throw new Error(`Database health check failed after migrations: ${dbHealth.error ?? 'unknown error'}. Rolling back is safe — services are still on old version.`);
      }
      this.appendLog('Database health verified — schema is accessible.');

      // 6. Rolling update non-API services first (one at a time, start-first)
      //    fleet_api is updated LAST in a separate step because updating it kills
      //    the container that's orchestrating this update.
      if (signal.aborted) throw new Error('Update aborted by admin');
      this.state.status = 'updating';
      this.state.servicesUpdated = [];
      await this.persistState();
      const nonApiServices = FLEET_SERVICES.filter((s) => s !== 'fleet_api');
      for (const serviceName of nonApiServices) {
        try {
          await this.updateSwarmService(serviceName, imageTag);
          this.state.servicesUpdated.push(serviceName);
          await this.persistState();

          // Verify digest after Docker pulled and applied the new image
          if (hasChecksums) {
            await this.verifyServiceDigest(serviceName, imageTag, expectedChecksums);
          }
        } catch (updateErr) {
          // Partial failure — roll back already-updated services
          this.appendLog(`Service ${serviceName} failed: ${String(updateErr)}`);
          if (this.state.servicesUpdated.length > 0) {
            this.appendLog(`Rolling back ${this.state.servicesUpdated.length} already-updated service(s)...`);
            this.state.status = 'rolling-back';
            await this.persistState();
            await this.rollbackServices([...this.state.servicesUpdated]);
          }
          throw new Error(
            `Update failed at ${serviceName} — rolled back ${this.state.servicesUpdated.length} service(s): ${String(updateErr)}`,
          );
        }
      }

      // 7. Run seeders (idempotent, non-fatal)
      this.state.status = 'seeding';
      await this.persistState();
      this.appendLog('Running seeders...');
      try {
        const result = await runSeeders();
        this.appendLog(`Seeders completed: ${result.executed} seeder(s) executed.`);
      } catch (err) {
        this.appendLog(`Seeder warning: ${String(err)} (non-fatal)`);
      }

      // 8. Verify non-API services are healthy — auto-rollback on failure
      this.state.status = 'verifying';
      await this.persistState();
      this.appendLog('Verifying service health post-update...');
      try {
        await this.verifyServiceHealth(nonApiServices);
      } catch (healthErr) {
        this.appendLog(`Health check FAILED: ${String(healthErr)}`);
        this.appendLog('Initiating automatic rollback due to health check failure...');
        try {
          await this.rollback(true); // skipLock — we already hold it from performUpdate
          throw new Error(`Update rolled back automatically — health check failed: ${String(healthErr)}`);
        } catch (rollbackErr) {
          if (String(rollbackErr).includes('rolled back automatically')) {
            throw rollbackErr;
          }
          this.appendLog(`Automatic rollback also failed: ${String(rollbackErr)}`);
          throw new Error(
            `CRITICAL: Health check failed AND rollback failed. Manual intervention required.\n` +
            `Health error: ${String(healthErr)}\n` +
            `Rollback error: ${String(rollbackErr)}\n` +
            (this.state.preUpdateBackupId ? `Pre-update backup: ${this.state.preUpdateBackupId}` : 'No backup available.'),
          );
        }
      }

      // 9. Mark completed and persist version BEFORE updating fleet_api.
      //    This is critical: updating fleet_api kills this container, so we must
      //    persist the success state first. The new container will see 'completed'
      //    and just clean up.
      const cleanVersion = targetVersion.replace(/^v/, '');
      this.state.currentVersion = cleanVersion;
      this.state.status = 'completed';
      this.state.finishedAt = new Date();
      this.appendLog(`Non-API services updated and verified. Persisting version...`);

      // Persist version to DB so new containers pick it up
      try {
        await upsert(
          platformSettings,
          { key: 'platform:currentVersion', value: cleanVersion },
          platformSettings.key,
          { value: cleanVersion, updatedAt: new Date() },
        );
      } catch (err) {
        this.appendLog(`Warning: Could not persist version to DB: ${String(err)}`);
      }

      await this.persistState();
      // Do NOT clear persisted state here — the new container after fleet_api
      // restart needs to load the completed state (with log) into memory.
      // It gets cleared in recoverFromInterruptedUpdate().
      this.events.emit('update', this.state);

      // Refresh the notification cache (use cleanVersion without 'v' prefix)
      this.cachedNotification = {
        available: false,
        current: cleanVersion,
        latest: this.cachedNotification.latest,
        checkedAt: new Date().toISOString(),
      };

      // 10. Update fleet_api LAST. This will trigger a rolling restart that kills
      //     this container. We do NOT wait for convergence — Docker handles it.
      //     The new container starts with 'completed' state already persisted.
      this.appendLog(`Updating fleet_api to ${imageTag} — API will restart...`);
      try {
        const swarmServices = await dockerService.listServices({ name: ['fleet_api'] });
        if (swarmServices.length > 0) {
          const svc = swarmServices[0]!;
          const newImage = `${IMAGE_PREFIX}/fleet-api:${imageTag}`;
          await dockerService.updateService(svc.ID as string, { image: newImage });
          this.appendLog('fleet_api update initiated. Container will restart momentarily.');
        }
      } catch (err) {
        // Non-fatal: all other services are already on the new version and the
        // update is persisted as completed. Admin can manually redeploy fleet_api.
        this.appendLog(`Warning: Could not update fleet_api automatically: ${String(err)}`);
        this.appendLog('All other services are updated. Redeploy fleet_api manually via SSH if needed.');
      }
    } catch (err) {
      // If aborted by forceReset(), don't overwrite the reset state
      if (signal.aborted) {
        logger.info('Update aborted by admin reset — stopping gracefully');
        return;
      }
      this.appendLog(`Update failed: ${String(err)}`);
      this.state.status = 'failed';
      this.state.finishedAt = new Date();
      await this.persistState();
      await this.clearPersistedState();
      this.events.emit('update', this.state);
      throw err;
    } finally {
      this.updateAbort = null;
      await this.releaseUpdateLock();
    }
  }

  // ── Rollback to previous version ──────────────────────────────

  /**
   * @param skipLock — true when called from within performUpdate() where the lock is already held
   */
  async rollback(skipLock = false): Promise<void> {
    if (this.state.previousImageTags.size === 0) {
      throw new Error('No previous version to roll back to — no snapshot available');
    }

    // Acquire distributed lock if this is an external rollback call
    if (!skipLock) {
      const fencingToken = await this.acquireUpdateLock();
      if (fencingToken === null) {
        throw new Error('Cannot rollback — another update/rollback is in progress (distributed lock held)');
      }
    }

    this.state.status = 'rolling-back';
    this.appendLog('Starting rollback to previous images...');

    try {
      await this.rollbackServices([...this.state.previousImageTags.keys()]);

      this.appendLog('Rollback completed. Verifying health...');
      await this.verifyServiceHealth();

      // If we have a pre-update backup, mention it
      if (this.state.preUpdateBackupId) {
        this.appendLog(`Pre-update backup available: ${this.state.preUpdateBackupId}`);
        this.appendLog('If database migrations need reverting, restore from this backup via POST /api/v1/backups/:id/restore');
      }

      this.state.status = 'idle';
      this.state.finishedAt = new Date();
      this.appendLog('Rollback completed successfully.');
      this.events.emit('update', this.state);
    } catch (err) {
      this.state.status = 'failed';
      this.state.finishedAt = new Date();
      this.appendLog(`Rollback failed: ${String(err)}`);
      this.events.emit('update', this.state);
      throw err;
    } finally {
      if (!skipLock) {
        await this.releaseUpdateLock();
      }
    }
  }

  /**
   * Roll back a specific list of services to their previous images.
   * Used for partial rollback (on mid-loop failure) and startup recovery.
   */
  async rollbackServices(serviceNames: string[]): Promise<void> {
    if (serviceNames.length === 0) return;

    this.appendLog(`Rolling back ${serviceNames.length} service(s): ${serviceNames.join(', ')}...`);

    for (const serviceName of serviceNames) {
      const previousImage = this.state.previousImageTags.get(serviceName);
      if (!previousImage) {
        this.appendLog(`  ${serviceName}: no snapshot available, skipping.`);
        continue;
      }

      try {
        const swarmServices = await dockerService.listServices({
          name: [serviceName],
        });

        if (swarmServices.length === 0) {
          this.appendLog(`  ${serviceName}: not found in swarm, skipping.`);
          continue;
        }

        const svc = swarmServices[0]!;
        const dockerSvcId = svc.ID as string;
        await dockerService.updateService(dockerSvcId, { image: previousImage });
        this.appendLog(`  ${serviceName}: rollback initiated to ${previousImage}`);
        await this.waitForServiceConvergence(dockerSvcId, serviceName);
        this.appendLog(`  ${serviceName}: rolled back successfully.`);
      } catch (err) {
        this.appendLog(`  ${serviceName}: rollback FAILED: ${String(err)}`);
      }
    }
  }

  // ── Private helpers ───────────────────────────────────────────

  /**
   * Acquire a distributed update lock using atomic INSERT ... ON CONFLICT.
   * Returns a fencing token if acquired, or null if the lock is held by another instance.
   */
  private async acquireUpdateLock(): Promise<number | null> {
    const now = new Date();
    const hostname = process.env['HOSTNAME'] ?? 'unknown';

    try {
      // Step 1: Read the current lock state
      const existing = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, LOCK_KEY),
      });

      const currentLock = existing?.value as LockValue | Record<string, never> | null;
      const isLocked = currentLock != null && 'lockedAt' in currentLock && currentLock.lockedAt != null;
      const isStale = isLocked && (now.getTime() - new Date(currentLock!.lockedAt).getTime() > LOCK_STALE_MS);

      if (isLocked && !isStale) {
        return null; // Lock is actively held
      }

      if (isStale) {
        this.appendLog(`Found stale update lock from ${(currentLock as LockValue).lockedBy} — overriding.`);
      }

      // Step 2: Compute next fencing token
      const prevToken = isLocked ? (currentLock as LockValue).fencingToken ?? 0 : 0;
      const nextToken = prevToken + 1;

      const lockValue: LockValue = {
        lockedAt: now.toISOString(),
        lockedBy: hostname,
        fencingToken: nextToken,
      };

      // Step 3: Atomic upsert — INSERT if no row, UPDATE on conflict.
      // Serializes concurrent upserts on the unique `key` constraint.
      await upsert(
        platformSettings,
        { key: LOCK_KEY, value: lockValue },
        platformSettings.key,
        { value: lockValue, updatedAt: now },
      );

      // Step 4: Read back to confirm our fencing token won the race
      const verify = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, LOCK_KEY),
      });
      const verifyLock = verify?.value as LockValue | null;

      if (verifyLock?.fencingToken === nextToken && verifyLock?.lockedBy === hostname) {
        this.fencingToken = nextToken;
        return nextToken;
      }

      // Another instance won the race
      return null;
    } catch (err) {
      logger.error({ err }, 'Failed to acquire update lock');
      return null;
    }
  }

  private async releaseUpdateLock(): Promise<void> {
    try {
      // Only release if we still hold the lock (fencing token matches)
      const existing = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, LOCK_KEY),
      });
      const lockData = existing?.value as LockValue | null;

      if (lockData?.fencingToken && lockData.fencingToken !== this.fencingToken) {
        logger.warn(
          { expected: this.fencingToken, actual: lockData.fencingToken },
          'Lock fencing token mismatch — another instance took over, skipping release',
        );
        return;
      }

      // Use empty object instead of null to satisfy NOT NULL constraint
      await upsert(
        platformSettings,
        { key: LOCK_KEY, value: {} },
        platformSettings.key,
        { value: {}, updatedAt: new Date() },
      );
    } catch (err) {
      logger.error({ err }, 'Failed to release update lock');
    }
  }

  /**
   * Persist the current update state to platformSettings for crash recovery.
   * Called after every phase transition. Truncates log to avoid unbounded growth.
   */
  private async persistState(): Promise<void> {
    try {
      const logLines = this.state.log.split('\n');
      const truncatedLog = logLines.length > MAX_PERSISTED_LOG_LINES
        ? logLines.slice(-MAX_PERSISTED_LOG_LINES).join('\n')
        : this.state.log;

      const persisted: PersistedUpdateState = {
        status: this.state.status,
        currentVersion: this.state.currentVersion,
        targetVersion: this.state.targetVersion,
        log: truncatedLog,
        startedAt: this.state.startedAt?.toISOString() ?? null,
        finishedAt: this.state.finishedAt?.toISOString() ?? null,
        previousImageTags: Object.fromEntries(this.state.previousImageTags),
        preUpdateBackupId: this.state.preUpdateBackupId,
        servicesUpdated: this.state.servicesUpdated,
        fencingToken: this.fencingToken,
      };

      await upsert(
        platformSettings,
        { key: STATE_KEY, value: persisted },
        platformSettings.key,
        { value: persisted, updatedAt: new Date() },
      );
    } catch (err) {
      logger.error({ err }, 'Failed to persist update state');
    }
  }

  /** Clear persisted state after update completes or recovery finishes. */
  private async clearPersistedState(): Promise<void> {
    try {
      await upsert(
        platformSettings,
        { key: STATE_KEY, value: {} },
        platformSettings.key,
        { value: {}, updatedAt: new Date() },
      );
    } catch (err) {
      logger.error({ err }, 'Failed to clear persisted update state');
    }
  }

  /** Load persisted update state from DB (returns null if none/empty). */
  static async loadPersistedState(): Promise<PersistedUpdateState | null> {
    try {
      const row = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, STATE_KEY),
      });
      if (!row?.value || typeof row.value !== 'object' || !('status' in (row.value as Record<string, unknown>))) {
        return null;
      }
      return row.value as PersistedUpdateState;
    } catch {
      return null;
    }
  }

  /**
   * Poll backup status until it completes or fails.
   * Timeout after 5 minutes — backups should not take longer.
   */
  private async waitForBackupCompletion(backupId: string, timeoutMs = 300_000): Promise<void> {
    const { backups, eq: eqOp } = await import('@fleet/db');
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const backup = await db.query.backups.findFirst({
        where: eqOp(backups.id, backupId),
      });

      if (!backup) {
        throw new Error(`Backup ${backupId} not found in database`);
      }

      if (backup.status === 'completed') {
        return;
      }

      if (backup.status === 'failed') {
        throw new Error(`Pre-update backup ${backupId} failed`);
      }

      // Still pending or in_progress — wait and retry
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    throw new Error(`Pre-update backup ${backupId} timed out after ${timeoutMs / 1000}s`);
  }

  private appendLog(msg: string) {
    const ts = new Date().toISOString();
    this.state.log += `[${ts}] ${msg}\n`;
    this.events.emit('update', this.state);
  }

  private async refreshNotification(): Promise<void> {
    try {
      // Only one replica should check GitHub per interval.
      // Use a Valkey lock so the other replicas skip and read the cached result.
      const valkey = await getValkey();
      if (valkey) {
        const lockTtl = Math.ceil(CHECK_INTERVAL_MS / 1000);
        const acquired = await valkey.set(
          'fleet:update-check-lock',
          process.env['HOSTNAME'] ?? '1',
          'EX', lockTtl,
          'NX',
        );
        if (!acquired) {
          // Another replica is handling or recently handled the check
          const cached = await valkey.get('fleet:update-notification');
          if (cached) {
            try { this.cachedNotification = JSON.parse(cached); } catch { /* ignore */ }
          }
          return;
        }
      }

      await this.checkForUpdates();

      // Cache result in Valkey for other replicas
      if (valkey) {
        try {
          await valkey.setex(
            'fleet:update-notification',
            Math.ceil(CHECK_INTERVAL_MS / 1000) * 2,
            JSON.stringify(this.cachedNotification),
          );
        } catch { /* ignore */ }
      }
    } catch {
      // Silently fail — will retry next interval
    }
  }

  private isNewerVersion(remoteTag: string, currentVersion: string): boolean {
    // Normalize: strip leading 'v' and pre-release suffix (e.g. -rc.1, -beta.2)
    const remote = remoteTag.replace(/^v/, '').replace(/-.*$/, '');
    const current = currentVersion.replace(/^v/, '').replace(/-.*$/, '');

    if (remote === current) return false;

    // Semantic version comparison (numeric parts only)
    const rParts = remote.split('.').map(Number);
    const cParts = current.split('.').map(Number);

    for (let i = 0; i < Math.max(rParts.length, cParts.length); i++) {
      const r = rParts[i] ?? 0;
      const c = cParts[i] ?? 0;
      if (r > c) return true;
      if (r < c) return false;
    }

    return false;
  }

  private async fetchGitHubReleases(limit = 10): Promise<ReleaseInfo[]> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'fleet-update-service',
    };
    if (GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
    }

    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=${limit}`,
      {
        headers,
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as Array<Record<string, unknown>>;
    return data.map((r) => ({
      tag: r['tag_name'] as string,
      name: (r['name'] as string) || (r['tag_name'] as string),
      body: (r['body'] as string) || '',
      publishedAt: r['published_at'] as string,
      htmlUrl: r['html_url'] as string,
      prerelease: r['prerelease'] as boolean,
      checksums: this.parseChecksums((r['body'] as string) || ''),
    }));
  }

  private async fetchRelease(version: string): Promise<ReleaseInfo | null> {
    const tag = version.startsWith('v') ? version : `v${version}`;
    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'fleet-update-service',
      };
      if (GITHUB_TOKEN) {
        headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
      }

      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tag}`,
        {
          headers,
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) return null;

      const r = (await res.json()) as Record<string, unknown>;
      return {
        tag: r['tag_name'] as string,
        name: (r['name'] as string) || (r['tag_name'] as string),
        body: (r['body'] as string) || '',
        publishedAt: r['published_at'] as string,
        htmlUrl: r['html_url'] as string,
        prerelease: r['prerelease'] as boolean,
        checksums: this.parseChecksums((r['body'] as string) || ''),
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse SHA-256 checksums from the release body.
   * Expected format in release notes (under a "## Checksums" heading):
   *
   *   ```
   *   sha256:abc123... ghcr.io/componentor/fleet-api:1.2.3
   *   sha256:def456... ghcr.io/componentor/fleet-dashboard:1.2.3
   *   ```
   */
  private parseChecksums(body: string): Record<string, string> {
    const checksums: Record<string, string> = {};
    const checksumSection = body.split(/##\s*Checksums/i)[1];
    if (!checksumSection) return checksums;

    const lines = checksumSection.split('\n');
    for (const line of lines) {
      const match = line.trim().match(/^(sha256:[a-f0-9]{64})\s+(.+)$/i);
      if (match) {
        checksums[match[2]!.trim()] = match[1]!;
      }
    }

    return checksums;
  }

  private async snapshotCurrentImages(): Promise<void> {
    for (const serviceName of FLEET_SERVICES) {
      try {
        const swarmServices = await dockerService.listServices({
          name: [serviceName],
        });

        if (swarmServices.length > 0) {
          const svc = swarmServices[0]!;
          const spec = svc.Spec as { TaskTemplate?: { ContainerSpec?: { Image?: string } } };
          // Docker stores the image with @sha256:digest appended after first pull
          const currentImage = spec?.TaskTemplate?.ContainerSpec?.Image ?? 'unknown';
          this.state.previousImageTags.set(serviceName, currentImage);
          this.appendLog(`  ${serviceName}: ${currentImage}`);
        }
      } catch (err) {
        this.appendLog(`  Warning: could not snapshot ${serviceName}: ${String(err)}`);
      }
    }
  }

  private static readonly IMAGE_MAP: Record<string, string> = {
    fleet_api: 'fleet-api',
    fleet_dashboard: 'fleet-dashboard',
    'fleet_ssh-gateway': 'fleet-ssh-gateway',
    fleet_agent: 'fleet-agent',
  };

  /**
   * Verify a single service's image digest AFTER Docker has pulled and applied it.
   * This prevents supply-chain attacks where a registry image is tampered with.
   */
  private async verifyServiceDigest(
    serviceName: string,
    imageTag: string,
    expectedChecksums: Record<string, string>,
  ): Promise<void> {
    const imageBase = UpdateService.IMAGE_MAP[serviceName];
    if (!imageBase) return;

    const imageName = `${IMAGE_PREFIX}/${imageBase}:${imageTag}`;
    const expectedDigest = expectedChecksums[imageName];
    if (!expectedDigest) {
      this.appendLog(`  No checksum for ${imageName} — skipping digest verification.`);
      return;
    }

    try {
      const swarmServices = await dockerService.listServices({
        name: [serviceName],
      });

      if (swarmServices.length === 0) return;

      const svc = swarmServices[0]!;
      const spec = svc.Spec as { TaskTemplate?: { ContainerSpec?: { Image?: string } } };
      const imageRef = spec?.TaskTemplate?.ContainerSpec?.Image ?? '';

      // After update, Docker stores: image:tag@sha256:digest
      const digestMatch = imageRef.match(/@(sha256:[a-f0-9]{64})/);
      if (digestMatch) {
        const actualDigest = digestMatch[1]!;
        if (actualDigest !== expectedDigest) {
          throw new Error(
            `Image digest mismatch for ${imageName}!\n` +
            `  Expected: ${expectedDigest}\n` +
            `  Actual:   ${actualDigest}\n` +
            `This could indicate a supply-chain attack. Initiating rollback.`,
          );
        }
        this.appendLog(`  ${serviceName}: digest verified post-update (${actualDigest.slice(0, 19)}...)`);
      } else {
        this.appendLog(`  ${serviceName}: no digest in image reference after update — Docker may not have resolved it yet.`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('digest mismatch')) {
        throw err; // Re-throw digest mismatches — these are critical
      }
      this.appendLog(`  Warning: could not verify digest for ${serviceName}: ${String(err)}`);
    }
  }

  private async updateSwarmService(serviceName: string, imageTag: string): Promise<void> {
    this.appendLog(`Updating ${serviceName} to tag ${imageTag}...`);

    try {
      const swarmServices = await dockerService.listServices({
        name: [serviceName],
      });

      if (swarmServices.length === 0) {
        this.appendLog(`  Service ${serviceName} not found in swarm, skipping.`);
        return;
      }

      const svc = swarmServices[0]!;
      const dockerSvcId = svc.ID as string;

      const imageMap: Record<string, string> = {
        fleet_api: `${IMAGE_PREFIX}/fleet-api:${imageTag}`,
        fleet_dashboard: `${IMAGE_PREFIX}/fleet-dashboard:${imageTag}`,
        'fleet_ssh-gateway': `${IMAGE_PREFIX}/fleet-ssh-gateway:${imageTag}`,
        fleet_agent: `${IMAGE_PREFIX}/fleet-agent:${imageTag}`,
      };

      const newImage = imageMap[serviceName];
      if (!newImage) {
        this.appendLog(`  No image mapping for ${serviceName}, skipping.`);
        return;
      }

      await dockerService.updateService(dockerSvcId, { image: newImage });
      this.appendLog(`  ${serviceName} update initiated (rolling, start-first).`);

      await this.waitForServiceConvergence(dockerSvcId, serviceName);
    } catch (err) {
      throw new Error(`Failed to update ${serviceName}: ${String(err)}`);
    }
  }

  private async waitForServiceConvergence(
    dockerServiceId: string,
    serviceName: string,
    timeoutMs = 180_000,
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        const tasks = await dockerService.getServiceTasks(dockerServiceId);
        const running = tasks.filter((t) => t.status === 'running' && t.desiredState === 'running');
        const pending = tasks.filter(
          (t) => t.desiredState === 'running' && t.status !== 'running' && t.status !== 'failed',
        );
        const failed = tasks.filter((t) => t.status === 'failed' && t.desiredState === 'running');

        if (pending.length === 0 && running.length > 0) {
          this.appendLog(`  ${serviceName} converged (${running.length} replicas running).`);
          return;
        }

        // If all desired tasks have failed, don't keep waiting
        if (failed.length > 0 && running.length === 0 && pending.length === 0) {
          throw new Error(`${serviceName}: all tasks failed to start`);
        }

        this.appendLog(`  ${serviceName}: ${running.length} running, ${pending.length} pending, ${failed.length} failed...`);
      } catch (err) {
        if (err instanceof Error && err.message.includes('all tasks failed')) {
          throw err;
        }
        // Ignore transient errors during convergence
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    throw new Error(`${serviceName} did not converge within ${timeoutMs / 1000}s — possible deployment issue`);
  }

  private async verifyServiceHealth(serviceNames: readonly string[] = FLEET_SERVICES): Promise<void> {
    for (const serviceName of serviceNames) {
      try {
        const swarmServices = await dockerService.listServices({
          name: [serviceName],
        });

        if (swarmServices.length === 0) continue;

        const svc = swarmServices[0]!;
        const tasks = await dockerService.getServiceTasks(svc.ID as string);
        const running = tasks.filter((t) => t.status === 'running');
        const failed = tasks.filter((t) => t.status === 'failed');

        this.appendLog(`  ${serviceName}: ${running.length} running, ${failed.length} failed`);

        if (running.length === 0) {
          throw new Error(`${serviceName} has no running tasks after update — rollback recommended`);
        }
      } catch (err) {
        if (err instanceof Error && err.message.includes('no running tasks')) {
          throw err;
        }
        this.appendLog(`  Warning: could not verify ${serviceName}: ${String(err)}`);
      }
    }
  }
}

export const updateService = new UpdateService();
