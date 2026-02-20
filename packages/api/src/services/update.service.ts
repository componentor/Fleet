import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { dockerService } from './docker.service.js';
import { backupService } from './backup.service.js';
import { logger } from './logger.js';
import { db, platformSettings, eq } from '@fleet/db';

const GITHUB_REPO = process.env['FLEET_GITHUB_REPO'] ?? 'componentor/fleet';
const IMAGE_PREFIX = process.env['FLEET_IMAGE_PREFIX'] ?? 'ghcr.io/componentor';
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

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
}

const FLEET_SERVICES = ['fleet_api', 'fleet_dashboard', 'fleet_ssh-gateway', 'fleet_agent'] as const;

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
  };

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
    const acquired = await this.acquireUpdateLock();
    if (!acquired) {
      throw new Error('Another update is already in progress (distributed lock held)');
    }

    this.state.status = 'backing-up';
    this.state.targetVersion = targetVersion;
    this.state.log = '';
    this.state.startedAt = new Date();
    this.state.finishedAt = null;
    this.state.previousImageTags.clear();
    this.state.preUpdateBackupId = null;

    const imageTag = targetVersion.startsWith('v') ? targetVersion.slice(1) : targetVersion;

    try {
      // 0. Pre-update backup (required in production)
      this.appendLog('Creating pre-update database backup...');
      try {
        const backup = await backupService.createBackup('system', undefined, 'nfs');
        this.state.preUpdateBackupId = backup.id;
        this.appendLog(`Pre-update backup queued: ${backup.id}`);

        // Wait for backup to actually complete before proceeding
        this.appendLog('Waiting for backup to complete...');
        await this.waitForBackupCompletion(backup.id);
        this.appendLog('Pre-update backup verified as completed.');
      } catch (err) {
        if (process.env['NODE_ENV'] === 'production') {
          this.appendLog(`FATAL: Pre-update backup failed: ${String(err)}`);
          throw new Error(`Cannot proceed with update — pre-update backup failed: ${String(err)}`);
        }
        this.appendLog(`Warning: Could not create pre-update backup: ${String(err)}`);
        this.appendLog('Proceeding without backup (non-production, migrations are transactional).');
      }

      // 1. Snapshot current image tags (with digests) for rollback
      this.state.status = 'pulling';
      this.appendLog('Snapshotting current service images for rollback...');
      await this.snapshotCurrentImages();

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
      const hasChecksums = Object.keys(expectedChecksums).length > 0;
      if (!hasChecksums) {
        const skipVerify = process.env['SKIP_UPDATE_DIGEST_VERIFICATION'] === '1';
        if (skipVerify) {
          this.appendLog('WARNING: No checksums in release notes — digest verification will be skipped.');
          this.appendLog('  This is NOT recommended for production deployments.');
        } else {
          throw new Error(
            'Release has no checksums — image integrity cannot be verified. ' +
            'Add a "## Checksums" section to release notes, or set SKIP_UPDATE_DIGEST_VERIFICATION=1 to bypass (NOT recommended).'
          );
        }
      } else {
        this.appendLog(`Found checksums for ${Object.keys(expectedChecksums).length} image(s) — will verify after each service update.`);
      }

      // 4. Run database migrations (transactional + advisory-locked)
      this.state.status = 'migrating';
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
      for (const serviceName of FLEET_SERVICES) {
        await this.updateSwarmService(serviceName, imageTag);

        // Verify digest after Docker pulled and applied the new image
        if (hasChecksums) {
          await this.verifyServiceDigest(serviceName, imageTag, expectedChecksums);
        }
      }

      // 7. Run seeders (idempotent, non-fatal)
      this.state.status = 'seeding';
      this.appendLog('Running seeders...');
      try {
        const result = await runSeeders();
        this.appendLog(`Seeders completed: ${result.executed} seeder(s) executed.`);
      } catch (err) {
        this.appendLog(`Seeder warning: ${String(err)} (non-fatal)`);
      }

      // 8. Verify all services are healthy — auto-rollback on failure
      this.state.status = 'verifying';
      this.appendLog('Verifying service health post-update...');
      try {
        await this.verifyServiceHealth();
      } catch (healthErr) {
        this.appendLog(`Health check FAILED: ${String(healthErr)}`);
        this.appendLog('Initiating automatic rollback due to health check failure...');
        try {
          await this.rollback();
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
      this.events.emit('update', this.state);
      throw err;
    } finally {
      await this.releaseUpdateLock();
    }
  }

  // ── Rollback to previous version ──────────────────────────────

  async rollback(): Promise<void> {
    if (this.state.previousImageTags.size === 0) {
      throw new Error('No previous version to roll back to — no snapshot available');
    }

    this.state.status = 'rolling-back';
    this.appendLog('Starting rollback to previous images...');

    try {
      for (const [serviceName, previousImage] of this.state.previousImageTags) {
        this.appendLog(`Rolling back ${serviceName} to ${previousImage}...`);
        try {
          const swarmServices = await dockerService.listServices({
            name: [serviceName],
          });

          if (swarmServices.length === 0) {
            this.appendLog(`  Service ${serviceName} not found, skipping.`);
            continue;
          }

          const svc = swarmServices[0]!;
          const dockerSvcId = svc.ID as string;
          await dockerService.updateService(dockerSvcId, { image: previousImage });
          this.appendLog(`  ${serviceName} rolled back successfully.`);

          // Wait for convergence before moving to next service
          await this.waitForServiceConvergence(dockerSvcId, serviceName);
        } catch (err) {
          this.appendLog(`  Failed to roll back ${serviceName}: ${String(err)}`);
        }
      }

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
    }
  }

  // ── Private helpers ───────────────────────────────────────────

  /**
   * Acquire a distributed update lock using the platformSettings table.
   * This prevents multiple API instances from running updates concurrently.
   */
  private async acquireUpdateLock(): Promise<boolean> {
    const LOCK_KEY = 'system:update_lock';
    try {
      const existing = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, LOCK_KEY),
      });

      if (existing) {
        const lockData = existing.value as { lockedAt?: string; lockedBy?: string } | null;
        if (lockData?.lockedAt) {
          // Check if lock is stale (older than 30 minutes — update should never take that long)
          const lockedAt = new Date(lockData.lockedAt).getTime();
          const staleThreshold = 30 * 60 * 1000;
          if (Date.now() - lockedAt < staleThreshold) {
            return false; // Lock is still valid
          }
          this.appendLog('Found stale update lock — overriding.');
        }
        await db.update(platformSettings)
          .set({ value: { lockedAt: new Date().toISOString(), lockedBy: process.env['HOSTNAME'] ?? 'unknown' }, updatedAt: new Date() })
          .where(eq(platformSettings.id, existing.id));
      } else {
        await db.insert(platformSettings).values({
          key: LOCK_KEY,
          value: { lockedAt: new Date().toISOString(), lockedBy: process.env['HOSTNAME'] ?? 'unknown' },
        });
      }
      return true;
    } catch (err) {
      logger.error({ err }, 'Failed to acquire update lock');
      return false;
    }
  }

  private async releaseUpdateLock(): Promise<void> {
    const LOCK_KEY = 'system:update_lock';
    try {
      const existing = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, LOCK_KEY),
      });
      if (existing) {
        await db.update(platformSettings)
          .set({ value: null, updatedAt: new Date() })
          .where(eq(platformSettings.id, existing.id));
      }
    } catch (err) {
      logger.error({ err }, 'Failed to release update lock');
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
    // Normalize: strip leading 'v'
    const remote = remoteTag.replace(/^v/, '');
    const current = currentVersion.replace(/^v/, '');

    if (remote === current) return false;

    // Semantic version comparison
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
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=${limit}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'fleet-update-service',
        },
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
      const res = await fetch(
        `https://api.github.com/repos/${GITHUB_REPO}/releases/tags/${tag}`,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'fleet-update-service',
          },
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
