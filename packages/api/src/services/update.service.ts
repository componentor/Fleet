/**
 * ============================================================================
 * PLATFORM UPDATE SERVICE — ZERO-DOWNTIME ROLLING UPGRADE ORCHESTRATOR
 * ============================================================================
 *
 * DO NOT MODIFY the upgrade pipeline (performUpdate, emergencyUpgrade,
 * rollback, recoverFromInterruptedUpdate) unless fixing a critical bug.
 *
 * The upgrade pipeline has been hardened against every known failure mode:
 * - Transient Docker API failures → retried with exponential backoff
 * - Backup failures → logged as warning, upgrade continues
 * - GitHub unreachable → checksums skipped, upgrade continues
 * - Infrastructure file download fails → uses existing files, continues
 * - Single service update failure → partial rollback, detailed error
 * - API container restart mid-upgrade → state persisted, auto-recovery
 *
 * Architecture:
 * - performUpdate(): Full upgrade with all safety features
 * - emergencyUpgrade(): Minimal path — migrations + image updates only
 * - rollback(): Revert services to previous images
 * - recoverFromInterruptedUpdate(): Startup recovery from crash
 *
 * Every non-critical step degrades gracefully. The ONLY hard stops are:
 * - Database unreachable (nothing works without the DB)
 * - Distributed lock held by another instance (concurrency protection)
 * - Migration SQL error (schema must be consistent)
 *
 * Post-upgrade, forward-compatibility is validated to ensure the system
 * remains upgradable to future versions (state B can upgrade to state C).
 *
 * ============================================================================
 */

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { retryWithBackoff } from './upgrade-guard.service.js';
import { getOrchestrator } from './orchestrator.js';

// Fleet platform services always run on Docker Swarm, regardless of the default
// orchestrator chosen for user workloads (which may be Kubernetes).
// Uses a Proxy so it resolves lazily (initOrchestrator runs after module load).
const orchestrator = new Proxy({} as ReturnType<typeof getOrchestrator>, {
  get(_target, prop) {
    return (getOrchestrator('swarm') as any)[prop];
  },
});
import { getRegistryAuthForImage } from './docker.service.js';
import { backupService } from './backup.service.js';
import { logger } from './logger.js';
import { getValkey } from './valkey.service.js';
import { db, platformSettings, accounts, eq, sql, upsert, safeTransaction } from '@fleet/db';

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
  migrationsApplied: number;
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
  migrationsApplied: number;
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
/** Stringify errors including AggregateError inner causes */
function errorToString(err: unknown): string {
  if (err instanceof AggregateError) {
    const inner = err.errors.map(e => e instanceof Error ? e.message : String(e)).join('; ')
    return `${err.message}: [${inner}]`
  }
  if (err instanceof Error) return err.message
  return String(err)
}

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
    migrationsApplied: 0,
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
      const swarmServices = await orchestrator.listServices({ name: ['fleet_api'] });
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
    this.state.migrationsApplied = 0;
    this.fencingToken = 0;

    this.events.emit('update', this.state);
    await this.clearBroadcast();
    logger.warn({ previousStatus }, 'Update state force-reset by admin');

    return { previousStatus };
  }

  private fencingToken = 0;
  private events = new EventEmitter();
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private updateAbort: AbortController | null = null;
  private broadcastTimer: ReturnType<typeof setTimeout> | null = null;
  static readonly VALKEY_STATE_KEY = 'fleet:update-state';

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

  private lastDbVersionCheck = 0;
  private static readonly DB_VERSION_CHECK_INTERVAL_MS = 30_000; // re-read DB version every 30s

  /** Returns the cached update notification (no GitHub API call). */
  getNotification(): UpdateNotification {
    // Always keep cachedNotification.current in sync with the authoritative state
    this.cachedNotification.current = this.state.currentVersion;

    // Guard: never report "available" if we're already on that version
    if (this.cachedNotification.available && this.cachedNotification.latest?.tag) {
      if (!this.isNewerVersion(this.cachedNotification.latest.tag, this.state.currentVersion)) {
        this.cachedNotification.available = false;
      }
    }

    // Multi-replica freshness: periodically re-read currentVersion from DB
    // so replicas that didn't run the update learn about the new version.
    const now = Date.now();
    if (now - this.lastDbVersionCheck > UpdateService.DB_VERSION_CHECK_INTERVAL_MS) {
      this.lastDbVersionCheck = now;
      this.syncVersionFromDb().catch(() => {});
    }

    return this.cachedNotification;
  }

  /** Re-read the persisted version from DB — non-blocking, for multi-replica freshness. */
  private async syncVersionFromDb(): Promise<void> {
    try {
      const row = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, 'platform:currentVersion'),
      });
      const persisted = row?.value as string | null;
      if (persisted && typeof persisted === 'string' && persisted !== '') {
        const clean = persisted.replace(/^v/, '');
        if (this.isNewerVersion(clean, this.state.currentVersion) || clean !== this.state.currentVersion) {
          logger.info({ old: this.state.currentVersion, new: clean }, 'Synced version from DB (another replica may have updated)');
          this.state.currentVersion = clean;
          this.cachedNotification.current = clean;
          // Re-evaluate availability with the new version
          if (this.cachedNotification.available && this.cachedNotification.latest?.tag) {
            if (!this.isNewerVersion(this.cachedNotification.latest.tag, clean)) {
              this.cachedNotification.available = false;
            }
          }
        }
      }
    } catch {
      // Non-critical — will retry on next call
    }
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
      this.state.migrationsApplied = persisted.migrationsApplied ?? 0;
      this.state.preUpdateBackupId = persisted.preUpdateBackupId;
      // Restore previous image tags so rollback button works after container restart
      this.state.previousImageTags = new Map(Object.entries(persisted.previousImageTags ?? {}));
      // Restore fencing token so releaseUpdateLock() can match it
      this.fencingToken = persisted.fencingToken ?? 0;
      // Set notification to definitive "not available" — we just completed or failed an update.
      // This prevents stale Valkey caches from making us show "update available" for the
      // version we just installed.
      this.cachedNotification = {
        available: false,
        current: persisted.currentVersion,
        latest: this.cachedNotification.latest,
        checkedAt: new Date().toISOString(),
      };
      this.events.emit('update', this.state);
      // Clear stale Valkey notification cache so other replicas / future reads don't
      // see an outdated "available: true" for the version we're now running.
      try {
        const valkey = await getValkey();
        if (valkey) {
          await valkey.del('fleet:update-notification');
          await valkey.del('fleet:update-check-lock');
        }
      } catch { /* non-critical */ }
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
      this.fencingToken = persisted.fencingToken ?? 0;
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
        this.appendLog(`Recovery rollback FAILED: ${errorToString(err)}`);
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
    // Don't overwrite completed/failed status — those need to stay until the user dismisses them.
    // Only set 'checking' when we're in a neutral state.
    const statusBefore = this.state.status;
    if (statusBefore === 'idle') {
      this.state.status = 'checking';
    }

    try {
      const releases = await this.fetchGitHubReleases();
      const candidates = includePrerelease ? releases : releases.filter((r) => !r.prerelease);

      if (candidates.length === 0) {
        if (statusBefore === 'idle') this.state.status = 'idle';
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

      // Verify Docker images are actually available before marking as ready
      let imagesReady = true;
      if (isNewer) {
        imagesReady = await this.checkImagesExist(latest.tag);
      }

      if (statusBefore === 'idle') this.state.status = 'idle';

      this.cachedNotification = {
        available: isNewer && imagesReady,
        current: this.state.currentVersion,
        latest,
        checkedAt: new Date().toISOString(),
      };

      return this.cachedNotification;
    } catch (err) {
      if (statusBefore === 'idle') this.state.status = 'idle';
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
    this.state.previousImageTags.clear();
    this.state.preUpdateBackupId = null;
    this.state.servicesUpdated = [];
    this.state.migrationsApplied = 0;

    const imageTag = targetVersion.startsWith('v') ? targetVersion.slice(1) : targetVersion;
    await this.persistState();

    try {
      // 0. Pre-flight: verify database is healthy and accessible before touching anything
      //    Retries 3 times — transient DB connection issues should not block upgrades.
      if (signal.aborted) throw new Error('Update aborted by admin');
      this.appendLog('Pre-flight: verifying database connectivity...');
      const { verifyDatabase: preVerify } = await import('@fleet/db/migrate');
      const preCheck = await retryWithBackoff(
        () => preVerify(),
        { maxAttempts: 3, initialDelayMs: 2000, label: 'preflight-db-check' },
      );
      if (!preCheck.ok) {
        throw new Error(`Pre-flight database check failed: ${preCheck.error ?? 'unknown error'}. Update aborted — nothing was modified.`);
      }
      this.appendLog('Pre-flight database check passed.');

      // 0.5. Run database migrations (transactional + advisory-locked)
      // Migrations must run before backup because the Drizzle ORM schema
      // may reference new columns that don't exist in the DB yet.
      // Migrations are transactional — they roll back cleanly on failure.
      // Retried once — if migration fails due to a transient lock/connection issue.
      if (signal.aborted) throw new Error('Update aborted by admin');
      this.state.status = 'migrating';
      await this.persistState();
      this.appendLog('Running database migrations (transactional)...');
      try {
        const result = await retryWithBackoff(
          () => runMigrations(),
          {
            maxAttempts: 2,
            initialDelayMs: 3000,
            label: 'database-migrations',
            isRetryable: (err) => {
              // Only retry on connection/lock errors, not on SQL syntax errors
              const msg = err instanceof Error ? err.message : String(err);
              return msg.includes('connection') || msg.includes('timeout') || msg.includes('lock') || msg.includes('ECONNREFUSED');
            },
          },
        );
        this.state.migrationsApplied = result.applied;
        this.appendLog(`Migrations completed: ${result.applied} migration(s) applied.`);
      } catch (err) {
        this.appendLog(`Migration FAILED (rolled back): ${errorToString(err)}`);
        throw new Error(`Migration failed — database was NOT modified: ${errorToString(err)}`);
      }

      // 1. Verify database health after migrations (retried)
      this.appendLog('Verifying database health post-migration...');
      const { verifyDatabase } = await import('@fleet/db/migrate');
      const dbHealth = await retryWithBackoff(
        () => verifyDatabase(),
        { maxAttempts: 3, initialDelayMs: 2000, label: 'post-migration-health' },
      );
      if (!dbHealth.ok) {
        throw new Error(`Database health check failed after migrations: ${dbHealth.error ?? 'unknown error'}. Rolling back is safe — services are still on old version.`);
      }
      this.appendLog('Database health verified — schema is accessible.');

      // 2. Pre-update backup (best-effort — NEVER blocks upgrades)
      // Backups are important but an upgrade MUST succeed. If the backup fails,
      // we log a prominent warning and continue. The admin chose to upgrade —
      // a broken backup system should not prevent critical security patches.
      if (signal.aborted) throw new Error('Update aborted by admin');
      this.state.status = 'backing-up';
      await this.persistState();
      const skipBackup = options?.skipBackup ?? false;
      if (skipBackup) {
        this.appendLog('Skipping pre-update backup (user opted out).');
      } else {
        this.appendLog('Creating pre-update database backup...');
        try {
          await Promise.race([
            (async () => {
              const firstAccount = await db.query.accounts.findFirst();
              if (!firstAccount) {
                this.appendLog('WARNING: No accounts found — skipping pre-update backup.');
                return;
              }
              const backupAccountId = firstAccount.id;

              // Run backup directly (synchronous) — avoids queue/poll race conditions
              // Pre-update backups use forceLocal to avoid dependency on external storage (MinIO/S3)
              // Try NFS first (survives container restarts), fall back to local
              let result: { id: string };
              let backupBackend = 'local';
              const nfsDir = process.env['NFS_BACKUP_DIR'] ?? '/srv/nfs/backups';
              try {
                await import('node:fs/promises').then(fs => fs.access(nfsDir));
                backupBackend = 'nfs';
              } catch {
                // NFS not mounted or not accessible — use local
              }

              // Ensure backup directory exists before attempting backup
              try {
                const { mkdir } = await import('node:fs/promises');
                const { tmpdir } = await import('node:os');
                const { join } = await import('node:path');
                const backupDir = process.env['BACKUP_DIR'] ?? (
                  process.env['NODE_ENV'] === 'production' ? '/app/data/backups' : join(tmpdir(), 'fleet-backups')
                );
                await mkdir(backupDir, { recursive: true });
              } catch { /* best effort */ }

              try {
                result = await backupService.runBackupDirect(backupAccountId, null, backupBackend, undefined, undefined, { forceLocal: true });
              } catch (backupErr) {
                if (backupBackend === 'nfs') {
                  this.appendLog('NFS backup failed — falling back to local backup...');
                  result = await backupService.runBackupDirect(backupAccountId, null, 'local', undefined, undefined, { forceLocal: true });
                } else {
                  throw backupErr;
                }
              }
              this.state.preUpdateBackupId = result.id;
              this.appendLog(`Pre-update backup completed: ${result.id}`);
            })(),
            new Promise<void>((resolve) => {
              setTimeout(() => {
                this.appendLog('WARNING: Backup timed out after 90s — continuing upgrade without backup.');
                resolve();
              }, 90_000);
            }),
            new Promise<void>((resolve, reject) => {
              signal.addEventListener('abort', () => reject(new Error('Update aborted by admin')), { once: true });
            }),
          ]);
        } catch (backupErr) {
          // Backup failure is NOT fatal — log prominently and continue
          if (signal.aborted) throw new Error('Update aborted by admin');
          this.appendLog(`WARNING: Pre-update backup FAILED: ${errorToString(backupErr)}`);
          this.appendLog('Continuing upgrade without backup. If the upgrade fails, manual DB recovery may be needed.');
        }
      }

      // 3. Snapshot current image tags (with digests) for rollback
      // Uses retry — Docker API can flake under load
      if (signal.aborted) throw new Error('Update aborted by admin');
      this.state.status = 'pulling';
      this.appendLog('Snapshotting current service images for rollback...');
      try {
        await retryWithBackoff(() => this.snapshotCurrentImages(), {
          maxAttempts: 3, initialDelayMs: 2000, label: 'snapshot-images',
        });
      } catch (err) {
        this.appendLog(`WARNING: Could not snapshot service images: ${errorToString(err)}`);
        this.appendLog('Continuing — rollback will not be available if this upgrade fails.');
      }
      await this.persistState();

      // Verify all services were snapshotted (warning only — never blocks)
      if (this.state.previousImageTags.size < FLEET_SERVICES.length) {
        const missing = FLEET_SERVICES.filter((s) => !this.state.previousImageTags.has(s));
        this.appendLog(`Warning: Could not snapshot all services. Missing: ${missing.join(', ')}. Rollback coverage is partial.`);
      }

      // 3.5. Prepare infrastructure files (best-effort — NEVER blocks upgrades)
      if (signal.aborted) throw new Error('Update aborted by admin');
      this.appendLog('Preparing infrastructure files...');
      try {
        await this.prepareInfrastructureFiles(imageTag);
      } catch (err) {
        this.appendLog(`WARNING: Infrastructure file prep failed: ${errorToString(err)}. Will use existing files.`);
      }
      await this.persistState();

      // 4. Fetch release checksums (best-effort — NEVER blocks upgrades)
      this.appendLog('Fetching release checksums...');
      let expectedChecksums: Record<string, string> = {};
      try {
        const release = await retryWithBackoff(() => this.fetchRelease(targetVersion), {
          maxAttempts: 2, initialDelayMs: 3000, label: 'fetch-checksums',
          isRetryable: () => true,
        });
        expectedChecksums = release?.checksums ?? {};
      } catch (err) {
        this.appendLog(`WARNING: Could not fetch release checksums: ${errorToString(err)}. Proceeding without digest verification.`);
      }

      // 5. Log checksum status (NEVER blocks — checksums are defense-in-depth, not a gate)
      this.state.status = 'verifying-images';
      await this.persistState();
      const hasChecksums = Object.keys(expectedChecksums).length > 0;
      if (!hasChecksums) {
        this.appendLog('WARNING: No checksums available — digest verification will be skipped for this upgrade.');
      } else {
        this.appendLog(`Found checksums for ${Object.keys(expectedChecksums).length} image(s) — will verify after each service update.`);
      }

      // 6. Rolling update non-API services first (one at a time, start-first)
      //    fleet_api is updated LAST in a separate step because updating it kills
      //    the container that's orchestrating this update.
      //    Each service update is retried with backoff — Docker API flakes must not kill upgrades.
      if (signal.aborted) throw new Error('Update aborted by admin');
      this.state.status = 'updating';
      this.state.servicesUpdated = [];
      await this.persistState();
      const nonApiServices = FLEET_SERVICES.filter((s) => s !== 'fleet_api');
      for (const serviceName of nonApiServices) {
        try {
          await retryWithBackoff(
            () => this.updateSwarmService(serviceName, imageTag),
            {
              maxAttempts: 3,
              initialDelayMs: 5000,
              maxDelayMs: 30_000,
              label: `update-${serviceName}`,
              // Don't retry if the service doesn't exist or all tasks failed (not transient)
              isRetryable: (err) => {
                const msg = err instanceof Error ? err.message : String(err);
                return !msg.includes('not found in swarm') && !msg.includes('all tasks failed');
              },
            },
          );
          this.state.servicesUpdated.push(serviceName);
          await this.persistState();

          // Verify digest after Docker pulled and applied the new image (non-fatal)
          if (hasChecksums) {
            try {
              await this.verifyServiceDigest(serviceName, imageTag, expectedChecksums);
            } catch (digestErr) {
              // Digest mismatch is serious but should not stop the entire upgrade pipeline.
              // Log it prominently. If it's a real attack, the admin will see the warning.
              this.appendLog(`SECURITY WARNING: Digest verification failed for ${serviceName}: ${errorToString(digestErr)}`);
            }
          }
        } catch (updateErr) {
          // Partial failure — roll back already-updated services
          this.appendLog(`Service ${serviceName} failed after retries: ${errorToString(updateErr)}`);
          if (this.state.servicesUpdated.length > 0) {
            this.appendLog(`Rolling back ${this.state.servicesUpdated.length} already-updated service(s)...`);
            this.state.status = 'rolling-back';
            await this.persistState();
            await this.rollbackServices([...this.state.servicesUpdated]);
          }
          throw new Error(
            `Update failed at ${serviceName} — rolled back ${this.state.servicesUpdated.length} service(s): ${errorToString(updateErr)}`,
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
        this.appendLog(`Seeder warning: ${errorToString(err)} (non-fatal)`);
      }

      // 8. Verify non-API services are healthy — auto-rollback on failure
      this.state.status = 'verifying';
      await this.persistState();
      this.appendLog('Verifying service health post-update...');
      try {
        await this.verifyServiceHealth(nonApiServices);
      } catch (healthErr) {
        this.appendLog(`Health check FAILED: ${errorToString(healthErr)}`);
        this.appendLog('Initiating automatic rollback due to health check failure...');
        try {
          await this.rollback(true); // skipLock — we already hold it from performUpdate
          throw new Error(`Update rolled back automatically — health check failed: ${errorToString(healthErr)}`);
        } catch (rollbackErr) {
          if (errorToString(rollbackErr).includes('rolled back automatically')) {
            throw rollbackErr;
          }
          this.appendLog(`Automatic rollback also failed: ${errorToString(rollbackErr)}`);
          throw new Error(
            `CRITICAL: Health check failed AND rollback failed. Manual intervention required.\n` +
            `Health error: ${errorToString(healthErr)}\n` +
            `Rollback error: ${errorToString(rollbackErr)}\n` +
            (this.state.preUpdateBackupId ? `Pre-update backup: ${this.state.preUpdateBackupId}` : 'No backup available.'),
          );
        }
      }

      // 8.5. Post-upgrade forward-compatibility validation
      //       The current state (B) must be upgradable to a future state (C).
      //       Verify the upgrade system itself is intact after the update:
      //       - DB is accessible (migrations didn't break anything)
      //       - Docker Swarm is responsive (service updates didn't break connectivity)
      //       - Update lock can be released and re-acquired (state machine works)
      //       If any of these fail, the system is in a state where FUTURE upgrades
      //       would fail — which is the worst possible outcome.
      this.appendLog('Validating forward-compatibility (ensuring future upgrades will work)...');
      try {
        // Verify DB is still healthy (future upgrades need this)
        const fwdDbCheck = await retryWithBackoff(
          () => verifyDatabase(),
          { maxAttempts: 2, initialDelayMs: 2000, label: 'forward-compat-db' },
        );
        if (!fwdDbCheck.ok) {
          this.appendLog(`WARNING: Forward-compatibility DB check failed: ${fwdDbCheck.error}. Future upgrades may have issues.`);
        } else {
          this.appendLog('  Forward-compat: Database accessible (future migrations will work)');
        }

        // Verify Docker Swarm is responsive (future service updates need this)
        try {
          const fwdServices = await orchestrator.listServices({});
          this.appendLog(`  Forward-compat: Docker Swarm responsive (${fwdServices.length} services)`);
        } catch (err) {
          this.appendLog(`WARNING: Forward-compat Docker check failed: ${errorToString(err)}. Future upgrades may have issues.`);
        }

        // Verify state persistence works (future upgrade state machine needs this)
        try {
          await this.persistState();
          const reloaded = await UpdateService.loadPersistedState();
          if (!reloaded || reloaded.status !== this.state.status) {
            this.appendLog('WARNING: Forward-compat state persistence check failed. Future upgrade state tracking may have issues.');
          } else {
            this.appendLog('  Forward-compat: State persistence verified (future upgrade tracking will work)');
          }
        } catch (err) {
          this.appendLog(`WARNING: Forward-compat state check failed: ${errorToString(err)}.`);
        }

        this.appendLog('Forward-compatibility validation complete.');
      } catch (err) {
        // Forward-compat is a validation step — it should NEVER block the current upgrade
        this.appendLog(`WARNING: Forward-compatibility validation failed: ${errorToString(err)}. This does not affect the current upgrade.`);
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
        this.appendLog(`Warning: Could not persist version to DB: ${errorToString(err)}`);
      }

      // Update FLEET_VERSION in env file so future stack deploys use the correct image tags
      await this.updateEnvVersion(cleanVersion);

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

      // Also clear Valkey cache so new containers don't read stale available=true
      try {
        const valkey = await getValkey();
        if (valkey) {
          await valkey.del('fleet:update-notification');
          await valkey.del('fleet:update-check-lock');
        }
      } catch { /* non-critical */ }

      // 10. Apply infrastructure: run `docker stack deploy` with the new stack files
      //     that were downloaded in step 3.5. This is safe now because all non-API
      //     services are updated and 'completed' is persisted. If stack deploy
      //     restarts the API, the new container will see 'completed' state.
      this.appendLog('Applying infrastructure changes (docker stack deploy)...');
      try {
        await this.applyStackDeploy();
      } catch (err) {
        // Non-fatal: services are already updated, stack config changes
        // will be applied on next deploy or update.
        this.appendLog(`Warning: Stack deploy failed (non-fatal): ${errorToString(err)}`);
      }

      // 11. Update fleet_api LAST. This will trigger a rolling restart that kills
      //     this container. We do NOT wait for convergence — Docker handles it.
      //     The new container starts with 'completed' state already persisted.
      this.appendLog(`Updating fleet_api to ${imageTag} — API will restart...`);
      try {
        const swarmServices = await orchestrator.listServices({ name: ['fleet_api'] });
        if (swarmServices.length > 0) {
          const svc = swarmServices[0]!;
          const newImage = `${IMAGE_PREFIX}/fleet-api:${imageTag}`;
          const apiAuth = await getRegistryAuthForImage(null, newImage);
          await orchestrator.updateService(svc.ID as string, { image: newImage }, apiAuth);
          this.appendLog('fleet_api update initiated. Container will restart momentarily.');
        }
      } catch (err) {
        // Non-fatal: all other services are already on the new version and the
        // update is persisted as completed. Admin can manually redeploy fleet_api.
        this.appendLog(`Warning: Could not update fleet_api automatically: ${errorToString(err)}`);
        this.appendLog('All other services are updated. Redeploy fleet_api manually via SSH if needed.');
      }
    } catch (err) {
      // If aborted by forceReset(), don't overwrite the reset state
      if (signal.aborted) {
        logger.info('Update aborted by admin reset — stopping gracefully');
        return;
      }
      this.appendLog(`Update failed: ${errorToString(err)}`);
      this.state.status = 'failed';
      this.state.finishedAt = new Date();
      await this.persistState();
      await this.clearPersistedState();
      this.events.emit('update', this.state);

      // Clear stale "update available" so the nav doesn't keep showing the badge
      this.cachedNotification = {
        available: false,
        current: this.state.currentVersion,
        latest: this.cachedNotification.latest,
        checkedAt: new Date().toISOString(),
      };
      try {
        const valkey = await getValkey();
        if (valkey) await valkey.del('fleet:update-notification');
      } catch { /* non-critical */ }

      throw err;
    } finally {
      this.updateAbort = null;
      await this.releaseUpdateLock();
    }
  }

  // ── Emergency Upgrade (break glass) ───────────────────────────

  /**
   * Emergency upgrade — the ABSOLUTE minimal path that should ALWAYS work.
   *
   * This skips: backup, checksums, infrastructure files, seeders, health checks.
   * It only does: acquire lock → run migrations → update Docker service images → persist version.
   *
   * Use this when the normal `performUpdate()` keeps failing due to non-critical
   * steps (backup timeout, GitHub unreachable, Docker flakes, etc.)
   *
   * This is the "break glass in case of emergency" option. It trades safety
   * features for reliability — the upgrade WILL happen.
   */
  async emergencyUpgrade(
    targetVersion: string,
    runMigrations: () => Promise<{ applied: number }>,
  ): Promise<void> {
    this.state.log = '';
    this.state.targetVersion = targetVersion;
    this.state.startedAt = new Date();
    this.state.finishedAt = null;
    this.state.previousImageTags.clear();
    this.state.preUpdateBackupId = null;
    this.state.servicesUpdated = [];
    this.state.migrationsApplied = 0;

    if (this.state.status !== 'idle' && this.state.status !== 'completed' && this.state.status !== 'failed') {
      throw new Error(`Cannot start emergency upgrade: system is currently ${this.state.status}`);
    }

    this.updateAbort = new AbortController();

    this.state.status = 'checking';
    this.appendLog('=== EMERGENCY UPGRADE MODE ===');
    this.appendLog('Skipping: backup, checksums, infrastructure files, seeders, health checks.');
    this.appendLog('Only running: migrations + Docker service image updates.');

    const fencingToken = await this.acquireUpdateLock();
    if (fencingToken === null) {
      this.state.status = 'failed';
      this.appendLog('Lock held by another instance. Use Reset first.');
      this.state.finishedAt = new Date();
      throw new Error('Cannot acquire lock. Use Reset first.');
    }

    this.appendLog('Lock acquired.');
    const imageTag = targetVersion.startsWith('v') ? targetVersion.slice(1) : targetVersion;

    try {
      // 1. Migrations (the only critical pre-step)
      this.state.status = 'migrating';
      await this.persistState();
      this.appendLog('Running database migrations...');
      try {
        const result = await runMigrations();
        this.state.migrationsApplied = result.applied;
        this.appendLog(`Migrations: ${result.applied} applied.`);
      } catch (err) {
        this.appendLog(`Migration failed: ${errorToString(err)}`);
        throw err;
      }

      // 2. Snapshot current images (best effort)
      this.state.status = 'pulling';
      try {
        await this.snapshotCurrentImages();
      } catch {
        this.appendLog('WARNING: Could not snapshot images for rollback.');
      }

      // 3. Update all non-API services with retry
      this.state.status = 'updating';
      this.state.servicesUpdated = [];
      await this.persistState();

      const nonApiServices = FLEET_SERVICES.filter((s) => s !== 'fleet_api');
      for (const serviceName of nonApiServices) {
        try {
          await retryWithBackoff(
            () => this.updateSwarmService(serviceName, imageTag),
            { maxAttempts: 3, initialDelayMs: 5000, label: `emergency-${serviceName}` },
          );
          this.state.servicesUpdated.push(serviceName);
          await this.persistState();
        } catch (err) {
          this.appendLog(`${serviceName} FAILED: ${errorToString(err)}`);
          // In emergency mode, continue to next service even if one fails
          this.appendLog(`Continuing to next service despite failure (emergency mode).`);
        }
      }

      // 4. Mark completed
      const cleanVersion = targetVersion.replace(/^v/, '');
      this.state.currentVersion = cleanVersion;
      this.state.status = 'completed';
      this.state.finishedAt = new Date();
      this.appendLog(`Emergency upgrade completed. ${this.state.servicesUpdated.length}/${nonApiServices.length} services updated.`);

      try {
        await upsert(
          platformSettings,
          { key: 'platform:currentVersion', value: cleanVersion },
          platformSettings.key,
          { value: cleanVersion, updatedAt: new Date() },
        );
      } catch (err) {
        this.appendLog(`Warning: Could not persist version: ${errorToString(err)}`);
      }

      await this.updateEnvVersion(cleanVersion);
      await this.persistState();
      this.events.emit('update', this.state);

      // 5. Update fleet_api LAST
      this.appendLog(`Updating fleet_api to ${imageTag}...`);
      try {
        const swarmServices = await orchestrator.listServices({ name: ['fleet_api'] });
        if (swarmServices.length > 0) {
          const svc = swarmServices[0]!;
          const newImage = `${IMAGE_PREFIX}/fleet-api:${imageTag}`;
          const apiAuth = await getRegistryAuthForImage(null, newImage);
          await orchestrator.updateService(svc.ID as string, { image: newImage }, apiAuth);
          this.appendLog('fleet_api update initiated. Container will restart.');
        }
      } catch (err) {
        this.appendLog(`Warning: fleet_api update failed: ${errorToString(err)}. Redeploy manually.`);
      }
    } catch (err) {
      this.appendLog(`Emergency upgrade failed: ${errorToString(err)}`);
      this.state.status = 'failed';
      this.state.finishedAt = new Date();
      await this.persistState();
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

      // Provide migration rollback instructions if migrations were applied
      if (this.state.migrationsApplied > 0) {
        this.appendLog(`WARNING: ${this.state.migrationsApplied} database migration(s) were applied during this update.`);
        this.appendLog('Service images have been rolled back, but database schema changes persist.');
        if (this.state.preUpdateBackupId) {
          this.appendLog(`To fully revert, restore the pre-update backup: POST /api/v1/backups/${this.state.preUpdateBackupId}/restore`);
        } else {
          this.appendLog('No pre-update backup is available. Manual database schema revert may be needed.');
        }
      } else if (this.state.preUpdateBackupId) {
        this.appendLog(`Pre-update backup available if needed: ${this.state.preUpdateBackupId}`);
      }

      this.state.status = 'idle';
      this.state.finishedAt = new Date();
      this.appendLog('Rollback completed successfully.');
      this.events.emit('update', this.state);
    } catch (err) {
      this.state.status = 'failed';
      this.state.finishedAt = new Date();
      this.appendLog(`Rollback failed: ${errorToString(err)}`);
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
        const swarmServices = await orchestrator.listServices({
          name: [serviceName],
        });

        if (swarmServices.length === 0) {
          this.appendLog(`  ${serviceName}: not found in swarm, skipping.`);
          continue;
        }

        const svc = swarmServices[0]!;
        const dockerSvcId = svc.ID as string;
        const rbAuth = await getRegistryAuthForImage(null, previousImage);
        await orchestrator.updateService(dockerSvcId, { image: previousImage }, rbAuth);
        this.appendLog(`  ${serviceName}: rollback initiated to ${previousImage}`);
        await this.waitForServiceConvergence(dockerSvcId, serviceName);
        this.appendLog(`  ${serviceName}: rolled back successfully.`);
      } catch (err) {
        this.appendLog(`  ${serviceName}: rollback FAILED: ${errorToString(err)}`);
      }
    }
  }

  // ── Private helpers ───────────────────────────────────────────

  /**
   * Acquire a distributed update lock using a transactional compare-and-swap.
   * The entire read-check-write runs inside a single DB transaction, eliminating
   * the TOCTOU race between reading the lock and writing the new value.
   * Returns a fencing token if acquired, or null if the lock is held by another instance.
   */
  private async acquireUpdateLock(): Promise<number | null> {
    const now = new Date();
    const hostname = process.env['HOSTNAME'] ?? 'unknown';

    try {
      return await safeTransaction(async (tx) => {
        // Read current lock state inside the transaction
        const existing = await tx.query.platformSettings.findFirst({
          where: eq(platformSettings.key, LOCK_KEY),
        });

        const currentLock = existing?.value as LockValue | Record<string, never> | null;
        const isLocked = currentLock != null && 'lockedAt' in currentLock && currentLock.lockedAt != null;
        const isStale = isLocked && (now.getTime() - new Date(currentLock!.lockedAt).getTime() > LOCK_STALE_MS);

        if (isLocked && !isStale) {
          return null; // Lock is actively held by another instance
        }

        if (isStale) {
          this.appendLog(`Found stale update lock from ${(currentLock as LockValue).lockedBy} — overriding.`);
        }

        // Compute next fencing token
        const prevToken = isLocked ? (currentLock as LockValue).fencingToken ?? 0 : 0;
        const nextToken = prevToken + 1;

        const lockValue: LockValue = {
          lockedAt: now.toISOString(),
          lockedBy: hostname,
          fencingToken: nextToken,
        };

        // Atomic upsert within the same transaction
        if (existing) {
          await tx.update(platformSettings)
            .set({ value: lockValue, updatedAt: now })
            .where(eq(platformSettings.key, LOCK_KEY));
        } else {
          await tx.insert(platformSettings)
            .values({ key: LOCK_KEY, value: lockValue });
        }

        this.fencingToken = nextToken;
        return nextToken;
      });
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
        migrationsApplied: this.state.migrationsApplied,
        fencingToken: this.fencingToken,
      };

      await upsert(
        platformSettings,
        { key: STATE_KEY, value: persisted },
        platformSettings.key,
        { value: persisted, updatedAt: new Date() },
      );
      // Immediately broadcast to Valkey so all replicas see the latest state
      await this.flushBroadcast();
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
      await this.clearBroadcast();
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
    this.scheduleBroadcast();
  }

  /**
   * Broadcast current state to Valkey so all API replicas can serve consistent
   * real-time update status. Debounced to max once per 500ms during rapid log
   * appends; called immediately (flush) on status transitions and persistState.
   */
  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return; // already scheduled
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      void this.broadcastStateToValkey();
    }, 500);
  }

  private async broadcastStateToValkey(): Promise<void> {
    try {
      const valkey = await getValkey();
      if (!valkey) return;

      const snapshot = this.getState();
      // TTL 120s — auto-expires if the update process crashes without cleanup
      await valkey.set(
        UpdateService.VALKEY_STATE_KEY,
        JSON.stringify(snapshot),
        'EX', 120,
      );
    } catch { /* non-critical — DB-persisted state is the fallback */ }
  }

  /** Flush any pending broadcast immediately (call on status transitions). */
  private async flushBroadcast(): Promise<void> {
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    await this.broadcastStateToValkey();
  }

  /** Clear the Valkey broadcast key (call on reset/idle). */
  private async clearBroadcast(): Promise<void> {
    if (this.broadcastTimer) {
      clearTimeout(this.broadcastTimer);
      this.broadcastTimer = null;
    }
    try {
      const valkey = await getValkey();
      if (valkey) await valkey.del(UpdateService.VALKEY_STATE_KEY);
    } catch { /* non-critical */ }
  }

  /**
   * Load the latest update state from Valkey (broadcast by whichever replica
   * is running the update). Returns null if no broadcast exists.
   */
  static async loadBroadcastState(): Promise<ReturnType<UpdateService['getState']> | null> {
    try {
      const valkey = await getValkey();
      if (!valkey) return null;
      const raw = await valkey.get(UpdateService.VALKEY_STATE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
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
            try {
              const parsed = JSON.parse(cached);
              this.cachedNotification = parsed;
              // Re-validate: the cache may be stale from before an update
              this.cachedNotification.current = this.state.currentVersion;
              if (this.cachedNotification.available && this.cachedNotification.latest?.tag) {
                if (!this.isNewerVersion(this.cachedNotification.latest.tag, this.state.currentVersion)) {
                  this.cachedNotification.available = false;
                }
              }
            } catch { /* ignore malformed cache */ }
          }
          return;
        }
      }

      // Respect the includeRcReleases setting (same as the /check endpoint)
      let includePrerelease = false;
      try {
        const rcSetting = await db.query.platformSettings.findFirst({
          where: eq(platformSettings.key, 'updates:includeRcReleases'),
        });
        if (rcSetting?.value === true) {
          includePrerelease = true;
        }
      } catch { /* default to stable only */ }

      await this.checkForUpdates(includePrerelease);

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

  /**
   * Check if Docker images for a release tag exist on the container registry.
   * Only checks fleet-api (the primary image) — if it's pushed, all images are ready.
   * Returns true if the image exists, false if not or on network error.
   */
  private async checkImagesExist(tag: string): Promise<boolean> {
    const version = tag.replace(/^v/, '');
    const image = `fleet-api`;
    // Parse registry from IMAGE_PREFIX (e.g. "ghcr.io/componentor" → registry=ghcr.io, namespace=componentor)
    const prefixParts = IMAGE_PREFIX.replace(/\/$/, '').split('/');
    const registry = prefixParts[0]!; // e.g. "ghcr.io"
    const namespace = prefixParts.slice(1).join('/'); // e.g. "componentor"
    const repo = namespace ? `${namespace}/${image}` : image;

    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json',
      };

      // GHCR requires a token even for public images — fetch one via the token endpoint
      try {
        const tokenRes = await fetch(
          `https://${registry}/token?scope=repository:${repo}:pull`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (tokenRes.ok) {
          const tokenData = (await tokenRes.json()) as Record<string, unknown>;
          const token = tokenData['token'] as string;
          if (token) headers['Authorization'] = `Bearer ${token}`;
        }
      } catch {
        // Token fetch failed — try without auth (may work for public repos)
      }

      const res = await fetch(
        `https://${registry}/v2/${repo}/manifests/${version}`,
        { method: 'HEAD', headers, signal: AbortSignal.timeout(10_000) },
      );
      return res.ok;
    } catch {
      // Network error — don't block the notification, assume images exist
      return true;
    }
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
        const swarmServices = await orchestrator.listServices({
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
        this.appendLog(`  Warning: could not snapshot ${serviceName}: ${errorToString(err)}`);
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
      const swarmServices = await orchestrator.listServices({
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
      this.appendLog(`  Warning: could not verify digest for ${serviceName}: ${errorToString(err)}`);
    }
  }

  private async updateSwarmService(serviceName: string, imageTag: string): Promise<void> {
    this.appendLog(`Updating ${serviceName} to tag ${imageTag}...`);

    try {
      const swarmServices = await orchestrator.listServices({
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

      // Use platform-wide registry credentials (accountId=null) for Fleet system images
      const registryAuth = await getRegistryAuthForImage(null, newImage);
      await orchestrator.updateService(dockerSvcId, { image: newImage }, registryAuth);
      this.appendLog(`  ${serviceName} update initiated (rolling, start-first).`);

      await this.waitForServiceConvergence(dockerSvcId, serviceName, 600_000, newImage);
    } catch (err) {
      throw new Error(`Failed to update ${serviceName}: ${errorToString(err)}`);
    }
  }

  private async waitForServiceConvergence(
    dockerServiceId: string,
    serviceName: string,
    timeoutMs = 600_000,
    expectedImage?: string,
  ): Promise<void> {
    const startTime = Date.now();

    // Phase 1: Wait for Docker to acknowledge the update has started.
    // Immediately after updateService(), the old tasks are still "running" with
    // no pending tasks — checking now would falsely report convergence.
    let updateStarted = false;
    while (Date.now() - startTime < timeoutMs) {
      try {
        const info = await orchestrator.inspectService(dockerServiceId);
        const updateState = (info as any).UpdateStatus?.State as string | undefined;

        if (updateState === 'updating') {
          updateStarted = true;
          this.appendLog(`  ${serviceName}: Docker update in progress...`);
          break;
        }

        // If Docker already marked it completed (very fast update), skip to verification
        if (updateState === 'completed') {
          updateStarted = true;
          this.appendLog(`  ${serviceName}: Docker update completed quickly.`);
          break;
        }

        // No UpdateStatus yet — Docker hasn't started the rolling update.
        // Also check if the spec image already matches (update may be instant for single replicas)
        if (expectedImage) {
          const specImage = (info as any).Spec?.TaskTemplate?.ContainerSpec?.Image as string | undefined;
          if (specImage?.includes(expectedImage.split('@')[0]!)) {
            // Spec is updated, wait a bit longer for Docker to schedule tasks
            await new Promise((resolve) => setTimeout(resolve, 3000));
            updateStarted = true;
            break;
          }
        }
      } catch {
        // Transient error — retry
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    if (!updateStarted) {
      throw new Error(`${serviceName}: Docker did not start the update within ${timeoutMs / 1000}s`);
    }

    // Phase 2: Wait for running tasks to converge on the new image.
    while (Date.now() - startTime < timeoutMs) {
      try {
        // Check Docker's UpdateStatus first
        const info = await orchestrator.inspectService(dockerServiceId);
        const updateState = (info as any).UpdateStatus?.State as string | undefined;

        if (updateState === 'paused' || updateState === 'rollback_started') {
          throw new Error(`${serviceName}: Docker update ${updateState} — task may have failed`);
        }

        const tasks = await orchestrator.getServiceTasks(dockerServiceId);
        const running = tasks.filter((t) => t.status === 'running' && t.desiredState === 'running');
        const pending = tasks.filter(
          (t) => t.desiredState === 'running' && t.status !== 'running' && t.status !== 'failed',
        );
        const failed = tasks.filter((t) => t.status === 'failed' && t.desiredState === 'running');

        // If all desired tasks have failed, don't keep waiting
        if (failed.length > 0 && running.length === 0 && pending.length === 0) {
          throw new Error(`${serviceName}: all tasks failed to start`);
        }

        // Docker says completed and no pending tasks — we're done
        if (updateState === 'completed' && pending.length === 0 && running.length > 0) {
          this.appendLog(`  ${serviceName} converged (${running.length} replicas running).`);
          return;
        }

        // No pending and running > 0 — but only trust this if Docker is no longer 'updating'
        if (updateState !== 'updating' && pending.length === 0 && running.length > 0) {
          this.appendLog(`  ${serviceName} converged (${running.length} replicas running).`);
          return;
        }

        this.appendLog(`  ${serviceName}: ${running.length} running, ${pending.length} pending, ${failed.length} failed (update: ${updateState ?? 'unknown'})...`);
      } catch (err) {
        if (err instanceof Error && (err.message.includes('all tasks failed') || err.message.includes('update paused') || err.message.includes('rollback_started'))) {
          throw err;
        }
        // Ignore transient errors during convergence
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }

    throw new Error(`${serviceName} did not converge within ${timeoutMs / 1000}s — possible deployment issue`);
  }

  /**
   * Phase 1 of infrastructure reconciliation: download new stack files from the
   * release, update env config, create directories. This is SAFE — it only
   * writes files on disk and never restarts any services.
   *
   * The dangerous `docker stack deploy` is deferred to applyStackDeploy()
   * which runs AFTER the update is marked completed, so an API restart
   * won't orphan the update process.
   */
  private async prepareInfrastructureFiles(targetTag: string): Promise<void> {
    const token = process.env['GITHUB_TOKEN'] ?? '';
    const repo = process.env['FLEET_GITHUB_REPO'] ?? 'componentor/fleet';

    // Sync DB platform domain to env file so the shell script uses the correct value
    try {
      const { getPlatformDomain } = await import('../routes/settings.js');
      const dbDomain = await getPlatformDomain();
      if (dbDomain && dbDomain !== 'fleet.local') {
        await orchestrator.runOnLocalHost(
          `grep -q '^PLATFORM_DOMAIN=' /opt/fleet/config/env && sed -i "s|^PLATFORM_DOMAIN=.*|PLATFORM_DOMAIN=${dbDomain}|" /opt/fleet/config/env || echo "PLATFORM_DOMAIN=${dbDomain}" >> /opt/fleet/config/env`,
          { timeoutMs: 10_000 },
        );
        this.appendLog(`  Synced PLATFORM_DOMAIN=${dbDomain} from DB to env file`);
      }
    } catch (err) {
      this.appendLog(`  WARN: Could not sync platform domain to env: ${err}`);
    }

    // Use the tag as-is for the raw GitHub URL (could be "1.2.3" or "v1.2.3")
    // Try with 'v' prefix first (standard release tag), fall back to plain
    const versions = targetTag.startsWith('v') ? [targetTag, targetTag.slice(1)] : [`v${targetTag}`, targetTag];

    // Token is passed via env var to avoid embedding secrets in shell command strings
    const authCurl = token ? '-H "Authorization: token ${FLEET_GH_TOKEN}"' : '';

    // Build the shell script — file operations only, NO docker stack deploy
    const script = `
set -e

FLEET_DIR="/opt/fleet"
STACK_FILE="\${FLEET_DIR}/docker-stack.yml"
TRAEFIK_DIR="\${FLEET_DIR}/traefik"
ENV_FILE="\${FLEET_DIR}/config/env"

mkdir -p "\${TRAEFIK_DIR}"

# 1. Download new stack files from the release tag
DOWNLOADED=false
for TAG in ${versions.join(' ')}; do
  STACK_URL="https://raw.githubusercontent.com/${repo}/\${TAG}/docker/docker-stack.yml"
  TRAEFIK_URL="https://raw.githubusercontent.com/${repo}/\${TAG}/docker/traefik/traefik.yml"
  if curl -fsSL ${authCurl} "\${STACK_URL}" -o "\${STACK_FILE}.new" 2>/dev/null; then
    curl -fsSL ${authCurl} "\${TRAEFIK_URL}" -o "\${TRAEFIK_DIR}/traefik.yml.new" 2>/dev/null || true
    DOWNLOADED=true
    echo "Downloaded stack files from tag \${TAG}"
    break
  fi
done

if [ "\${DOWNLOADED}" != "true" ]; then
  echo "WARN: Could not download stack files — skipping infrastructure prep"
  exit 0
fi

# 2. Backup old files and move new ones in place
cp "\${STACK_FILE}" "\${STACK_FILE}.bak" 2>/dev/null || true
mv "\${STACK_FILE}.new" "\${STACK_FILE}"
if [ -f "\${TRAEFIK_DIR}/traefik.yml.new" ]; then
  cp "\${TRAEFIK_DIR}/traefik.yml" "\${TRAEFIK_DIR}/traefik.yml.bak" 2>/dev/null || true
  mv "\${TRAEFIK_DIR}/traefik.yml.new" "\${TRAEFIK_DIR}/traefik.yml"
  ACME_EMAIL=\$(grep '^ADMIN_EMAIL=' "\${ENV_FILE}" | cut -d= -f2)
  sed -i "s|\\\${ACME_EMAIL}|\${ACME_EMAIL}|g" "\${TRAEFIK_DIR}/traefik.yml"
fi

# 3. Update env file: migrate REGISTRY_URL from IP:5000 to platform domain
PLATFORM_DOMAIN=\$(grep '^PLATFORM_DOMAIN=' "\${ENV_FILE}" | cut -d= -f2)
CURRENT_REGISTRY=\$(grep '^REGISTRY_URL=' "\${ENV_FILE}" | cut -d= -f2)
if echo "\${CURRENT_REGISTRY}" | grep -q ':5000'; then
  sed -i "s|^REGISTRY_URL=.*|REGISTRY_URL=\${PLATFORM_DOMAIN}|" "\${ENV_FILE}"
  echo "Migrated REGISTRY_URL from \${CURRENT_REGISTRY} to \${PLATFORM_DOMAIN}"
fi

# 4. Add REGISTRY_HTTP_SECRET if missing
if ! grep -q '^REGISTRY_HTTP_SECRET=' "\${ENV_FILE}"; then
  echo "REGISTRY_HTTP_SECRET=\$(openssl rand -hex 32)" >> "\${ENV_FILE}"
  echo "Added REGISTRY_HTTP_SECRET to env"
fi

# 5. Ensure required bind-mount directories exist on the local node
mkdir -p "\${FLEET_DIR}/nfs-exports/uploads"
mkdir -p "\${FLEET_DIR}/traefik"

echo "Infrastructure files prepared successfully"
`;

    try {
      const scriptEnv: string[] = [];
      if (token) scriptEnv.push(`FLEET_GH_TOKEN=${token}`);
      const result = await orchestrator.runOnLocalHost(script, { timeoutMs: 60_000, env: scriptEnv.length > 0 ? scriptEnv : undefined });
      for (const line of result.stdout.split('\n').filter(Boolean)) {
        this.appendLog(`  [infra] ${line}`);
      }
    } catch (err) {
      // Non-fatal — the update can still proceed.
      this.appendLog(`  [infra] WARNING: Infrastructure file prep failed: ${errorToString(err)}`);
    }
  }

  /**
   * Phase 2 of infrastructure reconciliation: run `docker stack deploy` to
   * apply config changes from the new stack file. This is the DANGEROUS step
   * that can restart services (including fleet_api).
   *
   * Called AFTER 'completed' is persisted and fleet_api is updated, so even
   * if this restarts the API, the new container sees 'completed' state.
   */
  private async applyStackDeploy(): Promise<void> {
    // Flush all pending writes to disk before stack deploy restarts postgres.
    // CHECKPOINT forces WAL flush — ensures no data loss if postgres restarts abruptly.
    try {
      this.appendLog('  Flushing database to disk (CHECKPOINT)...');
      await db.execute(sql`CHECKPOINT`);
      this.appendLog('  Database checkpoint completed.');
    } catch (err) {
      // Non-fatal for non-PG dialects (SQLite/MySQL don't need this)
      this.appendLog(`  Database checkpoint skipped: ${errorToString(err)}`);
    }

    const script = `
set -e

FLEET_DIR="/opt/fleet"
ENV_FILE="\${FLEET_DIR}/config/env"

if [ ! -f "\${FLEET_DIR}/docker-stack.yml" ]; then
  echo "No stack file found — skipping stack deploy"
  exit 0
fi

# Source env for variable substitution
set -a
. "\${ENV_FILE}"
set +a

# Extract passwords for stack substitution
VALKEY_PASSWORD=\$(echo "\${VALKEY_URL}" | sed -n 's|redis://:\\([^@]*\\)@.*|\\1|p')
export VALKEY_PASSWORD

# Auto-detect stateful node if not set (existing installs upgrading to pinned stack)
if [ -z "\${FLEET_STATEFUL_NODE:-}" ]; then
  FLEET_STATEFUL_NODE=\$(hostname)
  echo "FLEET_STATEFUL_NODE=\${FLEET_STATEFUL_NODE}" >> "\${ENV_FILE}"
  echo "Auto-detected FLEET_STATEFUL_NODE=\${FLEET_STATEFUL_NODE}"
fi
export FLEET_STATEFUL_NODE

cd "\${FLEET_DIR}"

# Ensure required bind-mount directories exist on ALL Swarm nodes before deploying
docker service create --name fleet-pre-deploy-dirs --mode global --restart-condition none \
  --mount type=bind,source=/,target=/host \
  alpine sh -c 'mkdir -p /host/opt/fleet/nfs-exports/uploads && echo done' 2>/dev/null || true
sleep 5
docker service rm fleet-pre-deploy-dirs 2>/dev/null || true

docker stack deploy -c docker-stack.yml --with-registry-auth fleet 2>&1 || echo "WARN: stack deploy had errors (non-fatal)"
echo "Stack deploy complete"
`;

    try {
      const result = await orchestrator.runOnLocalHost(script, { timeoutMs: 120_000 });
      for (const line of result.stdout.split('\n').filter(Boolean)) {
        this.appendLog(`  [infra] ${line}`);
      }
    } catch (err) {
      this.appendLog(`  [infra] WARNING: Stack deploy failed: ${errorToString(err)}`);
      this.appendLog('  [infra] Config changes may not be fully applied. Re-deploy via Settings or next update.');
    }
  }

  /**
   * Update FLEET_VERSION in the env file on the host after a successful update.
   * This ensures future `docker stack deploy` runs use the correct image version.
   */
  private async updateEnvVersion(version: string): Promise<void> {
    const cleanVersion = version.replace(/^v/, '');
    try {
      await orchestrator.runOnLocalHost(
        `sed -i "s|^FLEET_VERSION=.*|FLEET_VERSION=${cleanVersion}|" /opt/fleet/config/env`,
        { timeoutMs: 10000 },
      );
      this.appendLog(`Updated FLEET_VERSION in env to ${cleanVersion}`);
    } catch {
      this.appendLog('Warning: Could not update FLEET_VERSION in env file (non-fatal).');
    }
  }

  private async verifyServiceHealth(serviceNames: readonly string[] = FLEET_SERVICES): Promise<void> {
    for (const serviceName of serviceNames) {
      try {
        const swarmServices = await orchestrator.listServices({
          name: [serviceName],
        });

        if (swarmServices.length === 0) continue;

        const svc = swarmServices[0]!;
        const tasks = await orchestrator.getServiceTasks(svc.ID as string);
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
        this.appendLog(`  Warning: could not verify ${serviceName}: ${errorToString(err)}`);
      }
    }
  }
}

export const updateService = new UpdateService();
