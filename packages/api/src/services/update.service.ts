import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { dockerService } from './docker.service.js';
import { backupService } from './backup.service.js';
import { logger } from './logger.js';
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

  private fencingToken = 0;
  private events = new EventEmitter();
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  /** Cached notification for the dashboard to poll without hitting GitHub */
  private cachedNotification: UpdateNotification = {
    available: false,
    current: this.state.currentVersion,
    latest: null,
    checkedAt: new Date().toISOString(),
  };

  // ── Public API ─────────────────────────────────────────────────

  getState(): Omit<UpdateState, 'previousImageTags'> & { previousImageTags: Record<string, string> } {
    return {
      ...this.state,
      previousImageTags: Object.fromEntries(this.state.previousImageTags),
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

    const terminalStates: UpdateStatus[] = ['idle', 'completed', 'failed'];
    if (terminalStates.includes(persisted.status)) {
      // Previous update reached a terminal state — just clean up
      await this.clearPersistedState();
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
  ): Promise<void> {
    if (this.state.status !== 'idle') {
      throw new Error(`Cannot start update: system is currently ${this.state.status}`);
    }

    // Distributed lock: prevent concurrent updates across API instances
    const fencingToken = await this.acquireUpdateLock();
    if (fencingToken === null) {
      throw new Error('Another update is already in progress (distributed lock held)');
    }

    this.state.status = 'backing-up';
    this.state.targetVersion = targetVersion;
    this.state.log = '';
    this.state.startedAt = new Date();
    this.state.finishedAt = null;
    this.state.previousImageTags.clear();
    this.state.preUpdateBackupId = null;
    this.state.servicesUpdated = [];

    const imageTag = targetVersion.startsWith('v') ? targetVersion.slice(1) : targetVersion;
    await this.persistState();

    try {
      // 0. Pre-update backup (best-effort — try local fallback if NFS unavailable)
      this.appendLog('Creating pre-update database backup...');
      try {
        // Backups require a valid accountId (FK constraint) — use the first account
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

        // Wait for backup to actually complete before proceeding
        this.appendLog('Waiting for backup to complete...');
        await this.waitForBackupCompletion(backup.id);
        this.appendLog('Pre-update backup verified as completed.');
      } catch (err) {
        this.appendLog(`Warning: Could not create pre-update backup: ${String(err)}`);
        this.appendLog('Proceeding without backup (migrations are transactional).');
      }

      // 1. Snapshot current image tags (with digests) for rollback
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

      // 6. Rolling update each service (one at a time, start-first)
      //    Digest verification happens AFTER each update, when Docker has the new image
      this.state.status = 'updating';
      this.state.servicesUpdated = [];
      await this.persistState();
      for (const serviceName of FLEET_SERVICES) {
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

      // 8. Verify all services are healthy — auto-rollback on failure
      this.state.status = 'verifying';
      await this.persistState();
      this.appendLog('Verifying service health post-update...');
      try {
        await this.verifyServiceHealth();
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

      // 9. Done
      this.state.currentVersion = targetVersion;
      this.state.status = 'completed';
      this.state.finishedAt = new Date();
      this.appendLog(`Update to ${targetVersion} completed successfully.`);
      await this.persistState();
      await this.clearPersistedState();
      this.events.emit('update', this.state);

      // Refresh the notification cache
      this.cachedNotification = {
        available: false,
        current: targetVersion,
        latest: this.cachedNotification.latest,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      this.appendLog(`Update failed: ${String(err)}`);
      this.state.status = 'failed';
      this.state.finishedAt = new Date();
      await this.persistState();
      await this.clearPersistedState();
      this.events.emit('update', this.state);
      throw err;
    } finally {
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
      await this.checkForUpdates();
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

  private async verifyServiceHealth(): Promise<void> {
    for (const serviceName of FLEET_SERVICES) {
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
