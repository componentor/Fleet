import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile as fsReadFile, readdir, rm, stat, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { db, backups, backupSchedules, services, resourceLimits, platformSettings, storageClusters, insertReturning, updateReturning, deleteReturning, eq, and, isNull, sql, desc } from '@fleet/db';
import { getBackupQueue, isQueueAvailable } from './queue.service.js';
import { storageManager } from './storage/storage-manager.js';
import { STORAGE_BUCKETS } from './storage/storage-provider.js';
import { logger } from './logger.js';

const BACKUP_ENCRYPTION_ALGO = 'aes-256-gcm';
const BACKUP_IV_LENGTH = 12;
const BACKUP_IMAGE = 'debian:bookworm-slim';
const MAX_CHAIN_LENGTH = 7; // force new full backup after 7 incrementals
const DEFAULT_BACKUP_QUOTA_GB = 50;

function getEncryptionKey(): Buffer | null {
  const hex = process.env['ENCRYPTION_KEY'];
  if (!hex || !/^[0-9a-f]{64}$/i.test(hex)) return null;
  return Buffer.from(hex, 'hex');
}

const execFileAsync = promisify(execFile);

const BACKUP_DIR = process.env['BACKUP_DIR'] ?? '/app/data/backups';
const NFS_BACKUP_DIR = process.env['NFS_BACKUP_DIR'] ?? '/srv/nfs/backups';

export class BackupService {
  // ── Quota Methods ──────────────────────────────────────────────────────────

  /**
   * Get total backup storage used by an account (in bytes).
   */
  async getAccountBackupUsage(accountId: string): Promise<number> {
    const [result] = await db
      .select({ total: sql<number>`coalesce(sum(${backups.sizeBytes}), 0)` })
      .from(backups)
      .where(and(eq(backups.accountId, accountId), eq(backups.status, 'completed')));
    return Number(result?.total ?? 0);
  }

  /**
   * Get backup storage limit for an account (in bytes).
   * Falls back: account override → global default → DEFAULT_BACKUP_QUOTA_GB.
   */
  async getAccountBackupLimit(accountId: string): Promise<number> {
    // Account-specific limit
    const accountLimits = await db.query.resourceLimits.findFirst({
      where: eq(resourceLimits.accountId, accountId),
    });
    if (accountLimits?.maxBackupStorageGb != null) {
      return accountLimits.maxBackupStorageGb * 1024 * 1024 * 1024;
    }
    // Global default (accountId is null)
    const globalLimits = await db.query.resourceLimits.findFirst({
      where: isNull(resourceLimits.accountId),
    });
    if (globalLimits?.maxBackupStorageGb != null) {
      return globalLimits.maxBackupStorageGb * 1024 * 1024 * 1024;
    }
    return DEFAULT_BACKUP_QUOTA_GB * 1024 * 1024 * 1024;
  }

  /**
   * Get backup quota info for an account.
   */
  async getBackupQuota(accountId: string) {
    const [usedBytes, limitBytes] = await Promise.all([
      this.getAccountBackupUsage(accountId),
      this.getAccountBackupLimit(accountId),
    ]);
    const usedGb = Math.round((usedBytes / (1024 * 1024 * 1024)) * 100) / 100;
    const limitGb = Math.round((limitBytes / (1024 * 1024 * 1024)) * 100) / 100;
    const percentUsed = limitBytes > 0 ? Math.round((usedBytes / limitBytes) * 10000) / 100 : 0;
    return { usedBytes, limitBytes, usedGb, limitGb, percentUsed };
  }

  /**
   * Enforce backup quota — throws if account is over limit.
   */
  private async enforceBackupQuota(accountId: string): Promise<void> {
    const { usedBytes, limitBytes, percentUsed } = await this.getBackupQuota(accountId);
    if (usedBytes >= limitBytes) {
      throw new Error(
        `Backup quota exceeded: ${percentUsed}% used (${Math.round(usedBytes / 1024 / 1024)}MB / ${Math.round(limitBytes / 1024 / 1024)}MB)`,
      );
    }
  }

  // ── Cluster Resolution ────────────────────────────────────────────────────

  /**
   * Resolve which storage cluster to use for a backup.
   * Priority: explicit → account override → platform default → first cluster → null (local).
   */
  async resolveBackupCluster(accountId: string, requestedClusterId?: string): Promise<string | null> {
    // 1. Explicit cluster requested — must allow backups
    if (requestedClusterId) {
      const cluster = await db.query.storageClusters.findFirst({
        where: and(eq(storageClusters.id, requestedClusterId), eq(storageClusters.allowBackups, true)),
      });
      if (cluster) return cluster.id;
    }

    // 2. Account-level override — validate it still allows backups
    const accountLimits = await db.query.resourceLimits.findFirst({
      where: eq(resourceLimits.accountId, accountId),
    });
    if (accountLimits?.backupClusterId) {
      const overrideCluster = await db.query.storageClusters.findFirst({
        where: and(eq(storageClusters.id, accountLimits.backupClusterId), eq(storageClusters.allowBackups, true)),
      });
      if (overrideCluster) return overrideCluster.id;
      // Fall through if override cluster no longer allows backups
    }

    // 3. Platform default — validate it still allows backups
    const setting = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, 'limits:defaultBackupClusterId'),
    });
    if (setting?.value) {
      const defaultCluster = await db.query.storageClusters.findFirst({
        where: and(eq(storageClusters.id, String(setting.value)), eq(storageClusters.allowBackups, true)),
      });
      if (defaultCluster) return defaultCluster.id;
      // Fall through if default cluster no longer allows backups
    }

    // 4. First available backup-capable cluster
    const firstCluster = await db.query.storageClusters.findFirst({
      where: eq(storageClusters.allowBackups, true),
    });
    if (firstCluster) return firstCluster.id;

    // 5. No backup-capable clusters — local/NFS
    return null;
  }

  // ── Incremental Chain Detection ───────────────────────────────────────────

  /**
   * Detect if we can create an incremental backup for this account+service.
   * Returns chain info or null (create a full backup).
   */
  private async getChainInfo(
    accountId: string,
    serviceId: string | null,
  ): Promise<{
    parentId: string;
    nextLevel: number;
    parentBackup: typeof backups.$inferSelect;
  } | null> {
    // Find most recent completed level-0 (full) backup for this account+service
    const conditions = [
      eq(backups.accountId, accountId),
      eq(backups.status, 'completed'),
      eq(backups.level, 0),
    ];
    if (serviceId) {
      conditions.push(eq(backups.serviceId, serviceId));
    } else {
      conditions.push(isNull(backups.serviceId));
    }

    const fullBackup = await db.query.backups.findFirst({
      where: and(...conditions),
      orderBy: (b, { desc: d }) => d(b.createdAt),
    });

    if (!fullBackup) return null;

    // Count existing incrementals in this chain
    const chainBackups = await db.query.backups.findMany({
      where: and(
        eq(backups.parentId, fullBackup.id),
        eq(backups.status, 'completed'),
      ),
    });

    const chainLength = chainBackups.length;
    if (chainLength >= MAX_CHAIN_LENGTH) return null; // Force a new full backup

    // Find the most recent backup in the chain (could be the full or the latest incremental)
    const latestInChain = chainBackups.length > 0
      ? chainBackups.sort((a, b) => (b.level ?? 0) - (a.level ?? 0))[0]!
      : fullBackup;

    return {
      parentId: fullBackup.id,
      nextLevel: chainLength + 1,
      parentBackup: latestInChain,
    };
  }

  /**
   * Create a backup for an account, optionally scoped to a specific service.
   */
  async createBackup(
    accountId: string,
    serviceId?: string,
    storageBackend: string = 'nfs',
    options?: { clusterId?: string; expiresAt?: Date },
  ): Promise<{
    id: string;
    status: string;
    storagePath: string | null;
    sizeBytes: number;
  }> {
    // Enforce backup quota
    await this.enforceBackupQuota(accountId);

    // Resolve backup cluster
    const clusterId = await this.resolveBackupCluster(accountId, options?.clusterId ?? undefined);

    const backupId = randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = serviceId
      ? `${accountId}-${serviceId}-${timestamp}`
      : `${accountId}-full-${timestamp}`;

    const baseDir = storageBackend === 'nfs' ? NFS_BACKUP_DIR : BACKUP_DIR;
    const backupPath = join(baseDir, accountId, backupName);

    // Insert pending backup record
    const [backup] = await insertReturning(backups, {
      id: backupId,
      accountId,
      serviceId: serviceId ?? null,
      type: 'manual',
      status: 'pending',
      storagePath: backupPath,
      storageBackend,
      sizeBytes: 0,
      contents: [],
      level: 0,
      parentId: null,
      clusterId,
      expiresAt: options?.expiresAt ?? null,
    });

    if (!backup) {
      throw new Error('Failed to create backup record');
    }

    if (isQueueAvailable()) {
      // Queue backup job via BullMQ for distributed execution
      // Pass backupId so the worker updates THIS record instead of creating a new one
      await getBackupQueue().add('create-backup', {
        backupId,
        backupPath,
        accountId,
        serviceId,
        storageBackend,
        clusterId,
      }, { attempts: 2, backoff: { type: 'exponential', delay: 5000 } });
    } else {
      // Fallback: run in-process (local dev without Valkey)
      this.runBackup(backupId, accountId, serviceId ?? null, backupPath).catch(
        (err) => logger.error({ err, backupId }, `Backup ${backupId} failed`),
      );
    }

    return {
      id: backup.id,
      status: 'pending',
      storagePath: backupPath,
      sizeBytes: 0,
    };
  }

  /**
   * Run a backup directly (called by the BullMQ worker).
   * If backupId/backupPath are provided, uses the existing DB record
   * (created by createBackup). Otherwise creates a new record.
   */
  async runBackupDirect(
    accountId: string,
    serviceId: string | null,
    storageBackend: string = 'nfs',
    existingBackupId?: string,
    existingBackupPath?: string,
    options?: { forceLocal?: boolean },
  ): Promise<{ id: string }> {
    let backupId: string;
    let backupPath: string;

    if (existingBackupId && existingBackupPath) {
      // Reuse the record already created by createBackup()
      backupId = existingBackupId;
      backupPath = existingBackupPath;
    } else {
      // Standalone call — enforce quota and create a new record
      await this.enforceBackupQuota(accountId);

      backupId = randomUUID();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupName = serviceId
        ? `${accountId}-${serviceId}-${timestamp}`
        : `${accountId}-full-${timestamp}`;

      const baseDir = storageBackend === 'nfs' ? NFS_BACKUP_DIR : BACKUP_DIR;
      backupPath = join(baseDir, accountId, backupName);

      const clusterId = await this.resolveBackupCluster(accountId);

      await insertReturning(backups, {
        id: backupId,
        accountId,
        serviceId,
        type: 'manual',
        status: 'pending',
        storagePath: backupPath,
        storageBackend,
        sizeBytes: 0,
        contents: [],
        level: 0,
        parentId: null,
        clusterId,
      });
    }

    await this.runBackup(backupId, accountId, serviceId, backupPath, options?.forceLocal);
    return { id: backupId };
  }

  private async runBackup(
    backupId: string,
    accountId: string,
    serviceId: string | null,
    backupPath: string,
    forceLocal?: boolean,
  ): Promise<void> {
    // Use a temp directory for archive creation (Docker needs local paths)
    const tempDir = join(tmpdir(), `fleet-backup-${backupId}`);
    const useObjectStorage = forceLocal ? false : this.isObjectStorageAvailable();
    const objectKeyPrefix = `${accountId}/${backupId}`;

    try {
      // Mark as in progress
      await db
        .update(backups)
        .set({ status: 'in_progress' })
        .where(eq(backups.id, backupId));

      // Detect incremental chain
      const chainInfo = await this.getChainInfo(accountId, serviceId);
      const isIncremental = chainInfo !== null;
      const backupLevel = isIncremental ? chainInfo.nextLevel : 0;
      const parentId = isIncremental ? chainInfo.parentId : null;

      if (isIncremental) {
        logger.info({ backupId, parentId, level: backupLevel }, 'Creating incremental backup');
      }

      // Update backup record with chain info
      await db
        .update(backups)
        .set({ level: backupLevel, parentId })
        .where(eq(backups.id, backupId));

      // Create working directory (temp if using object storage, backupPath for legacy)
      const workDir = useObjectStorage ? tempDir : backupPath;
      await mkdir(workDir, { recursive: true });

      const contents: Array<{ type: string; name: string; path: string; objectKey?: string; encrypted?: boolean }> = [];

      if (serviceId) {
        // Backup a specific service
        const service = await db.query.services.findFirst({
          where: and(
            eq(services.id, serviceId),
            eq(services.accountId, accountId),
            isNull(services.deletedAt),
          ),
        });

        if (!service) {
          throw new Error(`Service ${serviceId} not found for account ${accountId}`);
        }

        // Backup service volumes
        const SAFE_VOLUME_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
        const serviceVolumes = (service.volumes as Array<{ source: string; target: string }>) ?? [];
        for (const vol of serviceVolumes) {
          // Validate volume source — only allow named volumes, block host paths and special chars
          if (!SAFE_VOLUME_NAME.test(vol.source) || vol.source.includes(':') || vol.source.includes('..')) {
            logger.warn({ volume: vol.source, serviceId }, 'Skipping backup: unsafe volume source');
            continue;
          }

          // Restore .snar from previous backup in chain if incremental
          const snarName = `snapshot-${vol.source.replace(/[/\\]/g, '_')}.snar`;
          const snarPath = join(workDir, snarName);
          if (isIncremental) {
            await this.restoreSnarFile(chainInfo.parentBackup, vol.source, snarPath, useObjectStorage);
          }

          const archiveName = `volume-${vol.source.replace(/[/\\]/g, '_')}.tar.gz`;
          const localArchivePath = join(workDir, archiveName);
          try {
            await this.execToFile('docker', [
              'run',
              '--rm',
              '-v', `${vol.source}:/source:ro`,
              '-v', `${workDir}:/work`,
              BACKUP_IMAGE,
              'tar',
              `--listed-incremental=/work/${snarName}`,
              '-czf', '-',
              '-C', '/source',
              '.',
            ], localArchivePath);

            // Encrypt the archive at rest
            const wasEncrypted = await this.encryptFile(localArchivePath);

            const objectKey = `${objectKeyPrefix}/${archiveName}`;
            if (useObjectStorage) {
              await this.uploadToObjectStorage(localArchivePath, objectKey);
            }

            contents.push({
              type: 'volume',
              name: vol.source,
              path: useObjectStorage ? objectKey : localArchivePath,
              objectKey: useObjectStorage ? objectKey : undefined,
              encrypted: wasEncrypted,
            });

            // Save the .snar file as a content item (needed for next incremental)
            const snarObjectKey = `${objectKeyPrefix}/${snarName}`;
            if (useObjectStorage) {
              await this.uploadToObjectStorage(snarPath, snarObjectKey);
            }
            contents.push({
              type: 'snar',
              name: snarName,
              path: useObjectStorage ? snarObjectKey : snarPath,
              objectKey: useObjectStorage ? snarObjectKey : undefined,
            });
          } catch (err) {
            logger.error({ err, volume: vol.source }, `Failed to backup volume ${vol.source}`);
          }
        }

        // Export service metadata as JSON
        const metadataName = 'service-metadata.json';
        const metadataPath = join(workDir, metadataName);
        const metadata = {
          service: {
            id: service.id,
            name: service.name,
            image: service.image,
            // env intentionally excluded — may contain secrets
            ports: service.ports,
            volumes: service.volumes,
            domain: service.domain,
            replicas: service.replicas,
          },
          timestamp: new Date().toISOString(),
          backupLevel,
          parentId,
        };

        await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        const metadataKey = `${objectKeyPrefix}/${metadataName}`;
        if (useObjectStorage) {
          await this.uploadToObjectStorage(metadataPath, metadataKey);
        }
        contents.push({
          type: 'metadata',
          name: metadataName,
          path: useObjectStorage ? metadataKey : metadataPath,
          objectKey: useObjectStorage ? metadataKey : undefined,
        });
      } else {
        // Full account backup — backup all services
        const accountServices = await db.query.services.findMany({
          where: and(eq(services.accountId, accountId), isNull(services.deletedAt)),
        });

        for (const service of accountServices) {
          const svcDir = join(workDir, service.id);
          await mkdir(svcDir, { recursive: true });

          const serviceVolumes = (service.volumes as Array<{ source: string; target: string }>) ?? [];
          for (const vol of serviceVolumes) {
            const snarName = `snapshot-${vol.source.replace(/[/\\]/g, '_')}.snar`;
            const snarPath = join(svcDir, snarName);
            if (isIncremental) {
              await this.restoreSnarFile(chainInfo.parentBackup, vol.source, snarPath, useObjectStorage);
            }

            const archiveName = `volume-${vol.source.replace(/[/\\]/g, '_')}.tar.gz`;
            try {
              await this.execToFile('docker', [
                'run',
                '--rm',
                '-v', `${vol.source}:/source:ro`,
                '-v', `${svcDir}:/work`,
                BACKUP_IMAGE,
                'tar',
                `--listed-incremental=/work/${snarName}`,
                '-czf', '-',
                '-C', '/source',
                '.',
              ], join(svcDir, archiveName));

              // Encrypt the archive at rest
              const wasEncrypted = await this.encryptFile(join(svcDir, archiveName));

              const objectKey = `${objectKeyPrefix}/${service.id}/${archiveName}`;
              if (useObjectStorage) {
                await this.uploadToObjectStorage(join(svcDir, archiveName), objectKey);
              }

              contents.push({
                type: 'volume',
                name: `${service.name}/${vol.source}`,
                path: useObjectStorage ? objectKey : join(svcDir, archiveName),
                objectKey: useObjectStorage ? objectKey : undefined,
                encrypted: wasEncrypted,
              });

              // Save .snar
              const snarObjectKey = `${objectKeyPrefix}/${service.id}/${snarName}`;
              if (useObjectStorage) {
                await this.uploadToObjectStorage(snarPath, snarObjectKey);
              }
              contents.push({
                type: 'snar',
                name: snarName,
                path: useObjectStorage ? snarObjectKey : snarPath,
                objectKey: useObjectStorage ? snarObjectKey : undefined,
              });
            } catch (err) {
              logger.error(
                { err, volume: vol.source, service: service.name },
                `Failed to backup volume ${vol.source} for service ${service.name}`,
              );
            }
          }
        }

        // Export account-wide metadata
        const metadataName = 'account-metadata.json';
        const metadataPath = join(workDir, metadataName);
        const metadata = {
          services: accountServices.map((s) => ({
            id: s.id,
            name: s.name,
            image: s.image,
            // env intentionally excluded — may contain secrets
            ports: s.ports,
            volumes: s.volumes,
            domain: s.domain,
            replicas: s.replicas,
          })),
          timestamp: new Date().toISOString(),
          backupLevel,
          parentId,
        };

        await writeFile(metadataPath, JSON.stringify(metadata, null, 2));
        const metadataKey = `${objectKeyPrefix}/${metadataName}`;
        if (useObjectStorage) {
          await this.uploadToObjectStorage(metadataPath, metadataKey);
        }
        contents.push({
          type: 'metadata',
          name: metadataName,
          path: useObjectStorage ? metadataKey : metadataPath,
          objectKey: useObjectStorage ? metadataKey : undefined,
        });
      }

      // Calculate total size
      const sizeBytes = await this.calculateDirSize(workDir);

      // Clean up temp directory if using object storage (files already uploaded)
      // Note: Also cleaned in finally block as a safety net
      if (useObjectStorage) {
        await rm(tempDir, { recursive: true, force: true }).catch((err) => {
          logger.warn({ err, tempDir }, 'Failed to clean up temp backup directory');
        });
      }

      // Mark as completed
      await db
        .update(backups)
        .set({
          status: 'completed',
          sizeBytes: Number(sizeBytes),
          storageBackend: useObjectStorage ? 'object' : (backupPath.startsWith(NFS_BACKUP_DIR) ? 'nfs' : 'local'),
          storagePath: useObjectStorage ? objectKeyPrefix : backupPath,
          contents,
          level: backupLevel,
          parentId,
        })
        .where(eq(backups.id, backupId));
    } catch (err) {
      logger.error({ err, backupId }, `Backup ${backupId} failed`);
      await db
        .update(backups)
        .set({ status: 'failed' })
        .where(eq(backups.id, backupId));
      throw err;
    } finally {
      // Always clean up temp dir (safety net for both success and failure paths)
      if (useObjectStorage && tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch((err) => {
          logger.warn({ err, tempDir }, 'Failed to clean up temp backup directory in finally block');
        });
      }
    }
  }

  /**
   * Restore from a backup. If the backup is incremental, walks the full chain.
   */
  async restoreBackup(backupId: string, accountId: string): Promise<{ message: string }> {
    const backup = await db.query.backups.findFirst({
      where: and(eq(backups.id, backupId), eq(backups.accountId, accountId)),
    });

    if (!backup) {
      throw new Error('Backup not found');
    }

    if (backup.status !== 'completed') {
      throw new Error(`Cannot restore from backup with status: ${backup.status}`);
    }

    if (!backup.storagePath) {
      throw new Error('Backup has no storage path');
    }

    // Build restore chain: for incremental backups, we need to restore from level-0 up
    const restoreChain: (typeof backup)[] = [];

    if ((backup.level ?? 0) > 0 && backup.parentId) {
      // Walk the chain: find the level-0 parent and all incrementals in order up to this level
      const parentBackup = await db.query.backups.findFirst({
        where: and(eq(backups.id, backup.parentId), eq(backups.accountId, accountId)),
      });
      if (!parentBackup || parentBackup.status !== 'completed') {
        throw new Error('Parent backup in chain is missing or incomplete — cannot restore incremental backup');
      }
      restoreChain.push(parentBackup);

      // Find all intermediate incrementals (level 1 to backup.level - 1) in this chain
      if ((backup.level ?? 0) > 1) {
        const intermediates = await db.query.backups.findMany({
          where: and(
            eq(backups.parentId, backup.parentId),
            eq(backups.accountId, accountId),
            eq(backups.status, 'completed'),
          ),
        });
        const sorted = intermediates
          .filter((b) => (b.level ?? 0) > 0 && (b.level ?? 0) < (backup.level ?? 0))
          .sort((a, b) => (a.level ?? 0) - (b.level ?? 0));
        restoreChain.push(...sorted);
      }
      restoreChain.push(backup);
    } else {
      restoreChain.push(backup);
    }

    logger.info({ backupId, chainLength: restoreChain.length, levels: restoreChain.map((b) => b.level) }, 'Restoring backup chain');

    const tempDir = join(tmpdir(), `fleet-restore-${backupId}`);

    // Mark backup as restoring
    await db
      .update(backups)
      .set({ status: 'restoring' })
      .where(eq(backups.id, backupId));

    try {
      await mkdir(tempDir, { recursive: true });

      // Restore each backup in the chain in order
      for (const chainBackup of restoreChain) {
        await this.restoreSingleBackup(chainBackup, tempDir);
      }

      // Mark as completed
      await db
        .update(backups)
        .set({ status: 'completed' })
        .where(eq(backups.id, backupId));

      return { message: restoreChain.length > 1
        ? `Backup restored successfully (applied ${restoreChain.length} backups in chain)`
        : 'Backup restored successfully' };
    } catch (err) {
      await db
        .update(backups)
        .set({ status: 'failed' })
        .where(eq(backups.id, backupId));
      throw err;
    } finally {
      // Clean up temp directory
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Restore a single backup's volume data. Used by restoreBackup for each step in the chain.
   */
  private async restoreSingleBackup(
    backup: typeof backups.$inferSelect,
    tempDir: string,
  ): Promise<void> {
    const backupContents = (backup.contents as Array<{ type: string; name: string; path: string; objectKey?: string; encrypted?: boolean }>) ?? [];
    const isObjectBacked = backup.storageBackend === 'object';
    const storagePath = backup.storagePath ?? '';

    for (const item of backupContents) {
      if (item.type !== 'volume') continue;

      // Extract volume name from the content entry
      const volumeName = item.name.includes('/')
        ? item.name.split('/').pop()!
        : item.name;

      // Validate volume name — must be a safe Docker named volume
      if (!volumeName || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(volumeName) || volumeName.includes('..')) {
        logger.error({ volumeName, item }, 'Skipping restore: invalid volume name');
        continue;
      }

      let archivePath: string;

      if (isObjectBacked && item.objectKey) {
        // Download from object storage to temp directory
        archivePath = join(tempDir, `${randomUUID()}.tar.gz`);
        try {
          const buffer = await storageManager.objects.getObjectBuffer(
            STORAGE_BUCKETS.BACKUPS,
            item.objectKey,
          );
          await writeFile(archivePath, buffer);
        } catch (err) {
          logger.error({ err, objectKey: item.objectKey }, 'Failed to download backup archive from object storage');
          continue;
        }
      } else {
        // Legacy filesystem path — validate it's within the backup directory
        const resolvedItemPath = resolve(item.path);
        const safeDirPrefix = storagePath.endsWith('/') ? storagePath : storagePath + '/';
        if (resolvedItemPath !== storagePath && !resolvedItemPath.startsWith(safeDirPrefix)) {
          logger.error({ itemPath: item.path, storagePath }, 'Skipping restore: path outside backup directory');
          continue;
        }
        archivePath = resolvedItemPath;
      }

      try {
        // Decrypt if the backup was encrypted
        if (item.encrypted) {
          await this.decryptFile(archivePath);
        }

        // Use GNU tar with --listed-incremental=/dev/null to process incremental metadata
        await this.execFromFile('docker', [
          'run',
          '--rm',
          '-i',
          '-v', `${volumeName}:/target`,
          BACKUP_IMAGE,
          'tar',
          '--listed-incremental=/dev/null',
          '-xzf', '-',
          '-C', '/target',
        ], archivePath);
      } catch (err) {
        logger.error({ err, volume: volumeName, backupId: backup.id, level: backup.level }, `Failed to restore volume ${volumeName}`);
      }
    }
  }

  /**
   * Delete a backup and its storage files.
   */
  async deleteBackup(backupId: string, accountId: string): Promise<boolean> {
    const backup = await db.query.backups.findFirst({
      where: and(eq(backups.id, backupId), eq(backups.accountId, accountId)),
    });

    if (!backup) {
      return false;
    }

    // Remove files from storage
    if (backup.storageBackend === 'object' && backup.storagePath) {
      // Delete from object storage by prefix (storagePath = accountId/backupId)
      try {
        await storageManager.objects.deletePrefix(STORAGE_BUCKETS.BACKUPS, backup.storagePath);
      } catch (err) {
        logger.error({ err, storagePath: backup.storagePath }, 'Failed to remove backup from object storage');
      }
    } else if (backup.storagePath) {
      // Legacy: remove from filesystem
      try {
        await rm(backup.storagePath, { recursive: true, force: true });
      } catch (err) {
        logger.error({ err, storagePath: backup.storagePath }, `Failed to remove backup files at ${backup.storagePath}`);
      }
    }

    // Remove DB record
    const result = await deleteReturning(
      backups,
      and(eq(backups.id, backupId), eq(backups.accountId, accountId))!,
    );

    return result.length > 0;
  }

  /**
   * List backups for an account.
   */
  async listBackups(accountId: string, serviceId?: string) {
    const conditions = [eq(backups.accountId, accountId)];

    if (serviceId) {
      conditions.push(eq(backups.serviceId, serviceId));
    }

    return db.query.backups.findMany({
      where: and(...conditions),
      orderBy: (b, { desc }) => desc(b.createdAt),
    });
  }

  /**
   * Get backup details.
   */
  async getBackup(backupId: string, accountId: string) {
    return db.query.backups.findFirst({
      where: and(eq(backups.id, backupId), eq(backups.accountId, accountId)),
    });
  }

  /**
   * Create a backup schedule.
   */
  async createSchedule(data: {
    accountId: string;
    serviceId?: string;
    cron: string;
    retentionDays?: number;
    retentionCount?: number;
    storageBackend?: string;
    clusterId?: string;
  }) {
    const [schedule] = await insertReturning(backupSchedules, {
      accountId: data.accountId,
      serviceId: data.serviceId ?? null,
      cron: data.cron,
      retentionDays: data.retentionDays ?? 30,
      retentionCount: data.retentionCount ?? 10,
      storageBackend: data.storageBackend ?? 'nfs',
      clusterId: data.clusterId ?? null,
      enabled: true,
    });

    return schedule;
  }

  /**
   * Update a backup schedule.
   */
  async updateSchedule(
    scheduleId: string,
    accountId: string,
    data: {
      cron?: string;
      retentionDays?: number;
      retentionCount?: number;
      storageBackend?: string;
      clusterId?: string;
      enabled?: boolean;
    },
  ) {
    const [updated] = await updateReturning(
      backupSchedules,
      {
        ...data,
        updatedAt: new Date(),
      },
      and(
        eq(backupSchedules.id, scheduleId),
        eq(backupSchedules.accountId, accountId),
      )!,
    );

    return updated ?? null;
  }

  /**
   * Delete a backup schedule.
   */
  async deleteSchedule(scheduleId: string, accountId: string): Promise<boolean> {
    const result = await deleteReturning(
      backupSchedules,
      and(
        eq(backupSchedules.id, scheduleId),
        eq(backupSchedules.accountId, accountId),
      )!,
    );

    return result.length > 0;
  }

  /**
   * List backup schedules for an account.
   */
  async listSchedules(accountId: string, serviceId?: string) {
    const conditions = [eq(backupSchedules.accountId, accountId)];
    if (serviceId) {
      conditions.push(eq(backupSchedules.serviceId, serviceId));
    }
    return db.query.backupSchedules.findMany({
      where: and(...conditions),
      orderBy: (s, { desc }) => desc(s.createdAt),
    });
  }

  /**
   * Get a single backup schedule.
   */
  async getSchedule(scheduleId: string, accountId: string) {
    return db.query.backupSchedules.findFirst({
      where: and(
        eq(backupSchedules.id, scheduleId),
        eq(backupSchedules.accountId, accountId),
      ),
    });
  }

  /**
   * Manually trigger a scheduled backup.
   */
  async runScheduledBackup(scheduleId: string, accountId: string) {
    const schedule = await this.getSchedule(scheduleId, accountId);

    if (!schedule) {
      throw new Error('Schedule not found');
    }

    return this.createBackup(
      schedule.accountId,
      schedule.serviceId ?? undefined,
      schedule.storageBackend ?? 'nfs',
      { clusterId: schedule.clusterId ?? undefined },
    );
  }

  /**
   * Execute a command and stream its stdout to a file.
   * Avoids host-path volume mounts so backups work when the API runs inside a container.
   */
  private execToFile(cmd: string, args: string[], outputPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        signal: AbortSignal.timeout(300_000),
      });
      const output = createWriteStream(outputPath);
      let stderr = '';
      let rejected = false;

      child.stderr!.on('data', (chunk: Buffer) => {
        if (stderr.length < 10_000) stderr += chunk.toString();
      });
      child.stdout!.pipe(output);

      child.on('error', (err) => {
        if (!rejected) { rejected = true; output.destroy(); reject(err); }
      });
      output.on('error', (err) => {
        if (!rejected) { rejected = true; child.kill(); reject(err); }
      });

      child.on('close', (code) => {
        if (rejected) return;
        if (code !== 0) {
          rejected = true;
          reject(new Error(`Command "${cmd}" failed with code ${code}\n${stderr}`));
        } else {
          const done = () => { if (!rejected) resolve(); };
          if (output.writableFinished) done();
          else output.on('finish', done);
        }
      });
    });
  }

  /**
   * Execute a command and pipe a file to its stdin.
   * Avoids host-path volume mounts so restores work when the API runs inside a container.
   */
  private execFromFile(cmd: string, args: string[], inputPath: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
        signal: AbortSignal.timeout(300_000),
      });
      const input = createReadStream(inputPath);
      let stderr = '';
      let rejected = false;

      child.stderr!.on('data', (chunk: Buffer) => {
        if (stderr.length < 10_000) stderr += chunk.toString();
      });
      input.pipe(child.stdin!);

      child.on('error', (err) => {
        if (!rejected) { rejected = true; input.destroy(); reject(err); }
      });
      input.on('error', (err) => {
        if (!rejected) { rejected = true; child.kill(); reject(err); }
      });

      child.on('close', (code) => {
        if (rejected) return;
        if (code !== 0) {
          rejected = true;
          reject(new Error(`Command "${cmd}" failed with code ${code}\n${stderr}`));
        } else {
          resolve();
        }
      });
    });
  }

  /**
   * Execute a shell command and return stdout.
   */
  private async exec(cmd: string, args: string[]): Promise<string> {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        maxBuffer: 50 * 1024 * 1024,
        timeout: 300_000, // 5 min timeout
      });
      return stdout + (stderr ? `\n${stderr}` : '');
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number };
      const output = (execErr.stdout ?? '') + (execErr.stderr ?? '');
      throw new Error(
        `Command "${cmd} ${args.join(' ')}" failed with code ${execErr.code}\n${output}`,
      );
    }
  }

  /**
   * Check if the storage system's object storage is available and non-local.
   * When using distributed object storage (MinIO/S3/GCS), backups go there.
   * When using local object storage, keep the legacy filesystem approach.
   */
  private isObjectStorageAvailable(): boolean {
    try {
      const config = storageManager.config;
      return !!config && config.objectProvider !== 'local';
    } catch {
      return false;
    }
  }

  /**
   * Upload a local file to the object storage backup bucket.
   */
  private async uploadToObjectStorage(localPath: string, objectKey: string): Promise<void> {
    const data = createReadStream(localPath);
    const fileStat = await stat(localPath);
    await storageManager.objects.putObject(
      STORAGE_BUCKETS.BACKUPS,
      objectKey,
      data,
      fileStat.size,
    );
  }

  /**
   * Calculate total size of a directory in bytes.
   * Uses du -sb (Linux), du -sk (macOS fallback), or recursive stat.
   */
  private async calculateDirSize(dirPath: string): Promise<number> {
    // Try du -sb (Linux GNU coreutils)
    try {
      const { stdout } = await execFileAsync('du', ['-sb', dirPath]);
      const sizeStr = stdout.trim().split('\t')[0];
      return parseInt(sizeStr ?? '0', 10);
    } catch {
      // Fallback: du -sk (macOS / BSD) — outputs KB
      try {
        const { stdout } = await execFileAsync('du', ['-sk', dirPath]);
        const sizeStr = stdout.trim().split('\t')[0];
        return parseInt(sizeStr ?? '0', 10) * 1024;
      } catch {
        // Final fallback: recursive readdir + stat
        return this.calculateDirSizeRecursive(dirPath);
      }
    }
  }

  /**
   * Recursively calculate directory size by statting each file.
   */
  private async calculateDirSizeRecursive(dirPath: string): Promise<number> {
    let total = 0;
    try {
      const entries = await readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
          total += await this.calculateDirSizeRecursive(fullPath);
        } else {
          const fileStat = await stat(fullPath);
          total += fileStat.size;
        }
      }
    } catch {
      // Directory doesn't exist or not readable
    }
    return total;
  }

  /**
   * Restore a .snar file from a previous backup in the chain.
   * Copies the .snar content item from the parent backup to the target path.
   */
  private async restoreSnarFile(
    parentBackup: typeof backups.$inferSelect,
    volumeName: string,
    targetPath: string,
    useObjectStorage: boolean,
  ): Promise<void> {
    const parentContents = (parentBackup.contents as Array<{ type: string; name: string; path: string; objectKey?: string }>) ?? [];
    const snarName = `snapshot-${volumeName.replace(/[/\\]/g, '_')}.snar`;
    const snarItem = parentContents.find((c) => c.type === 'snar' && c.name === snarName);

    if (!snarItem) {
      logger.warn({ parentBackupId: parentBackup.id, volumeName }, 'No .snar file found in parent backup — creating full backup for this volume');
      return;
    }

    try {
      if (parentBackup.storageBackend === 'object' && snarItem.objectKey) {
        const buffer = await storageManager.objects.getObjectBuffer(
          STORAGE_BUCKETS.BACKUPS,
          snarItem.objectKey,
        );
        await writeFile(targetPath, buffer);
      } else {
        // Filesystem — copy the .snar file
        await copyFile(snarItem.path, targetPath);
      }
    } catch (err) {
      logger.warn({ err, parentBackupId: parentBackup.id, volumeName }, 'Failed to restore .snar file — will create full backup for this volume');
    }
  }

  /**
   * Encrypt a backup archive file in-place using AES-256-GCM.
   * Writes: [12-byte IV][ciphertext][16-byte auth tag]
   * Returns true if encrypted, false if encryption is unavailable.
   */
  private async encryptFile(filePath: string): Promise<boolean> {
    const key = getEncryptionKey();
    if (!key) return false;

    const iv = randomBytes(BACKUP_IV_LENGTH);
    const cipher = createCipheriv(BACKUP_ENCRYPTION_ALGO, key, iv);
    const encPath = filePath + '.enc';

    const output = createWriteStream(encPath);
    // Write IV header first
    output.write(iv);

    await pipeline(
      createReadStream(filePath),
      cipher,
      output,
    );

    // Append the auth tag (16 bytes) at the end
    const tag = cipher.getAuthTag();
    const { appendFile } = await import('node:fs/promises');
    await appendFile(encPath, tag);

    // Replace the original with the encrypted version
    await rm(filePath, { force: true });
    const { rename } = await import('node:fs/promises');
    await rename(encPath, filePath);

    return true;
  }

  /**
   * Decrypt a backup archive file in-place.
   * Expects format: [12-byte IV][ciphertext][16-byte auth tag]
   * Returns true if decrypted, false if encryption is unavailable.
   */
  private async decryptFile(filePath: string): Promise<boolean> {
    const key = getEncryptionKey();
    if (!key) return false;

    const fileData = await fsReadFile(filePath);
    if (fileData.length < BACKUP_IV_LENGTH + 16) {
      // Too small to be encrypted — skip
      return false;
    }

    const iv = fileData.subarray(0, BACKUP_IV_LENGTH);
    const tag = fileData.subarray(fileData.length - 16);
    const ciphertext = fileData.subarray(BACKUP_IV_LENGTH, fileData.length - 16);

    const decipher = createDecipheriv(BACKUP_ENCRYPTION_ALGO, key, iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    await writeFile(filePath, decrypted);

    return true;
  }
}

export const backupService = new BackupService();
