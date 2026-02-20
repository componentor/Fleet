import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createReadStream } from 'node:fs';
import { mkdir, readFile as fsReadFile, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { db, backups, backupSchedules, services, insertReturning, updateReturning, deleteReturning, eq, and, isNull } from '@fleet/db';
import { getBackupQueue, isQueueAvailable } from './queue.service.js';
import { storageManager } from './storage/storage-manager.js';
import { STORAGE_BUCKETS } from './storage/storage-provider.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

const BACKUP_DIR = process.env['BACKUP_DIR'] ?? '/var/fleet/backups';
const NFS_BACKUP_DIR = process.env['NFS_BACKUP_DIR'] ?? '/mnt/nfs/backups';

export class BackupService {
  /**
   * Create a backup for an account, optionally scoped to a specific service.
   */
  async createBackup(
    accountId: string,
    serviceId?: string,
    storageBackend: string = 'nfs',
  ): Promise<{
    id: string;
    status: string;
    storagePath: string | null;
    sizeBytes: bigint;
  }> {
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
      sizeBytes: BigInt(0),
      contents: [],
    });

    if (!backup) {
      throw new Error('Failed to create backup record');
    }

    if (isQueueAvailable()) {
      // Queue backup job via BullMQ for distributed execution
      await getBackupQueue().add('create-backup', {
        accountId,
        serviceId,
        storageBackend,
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
      sizeBytes: BigInt(0),
    };
  }

  /**
   * Run a backup directly (called by the BullMQ worker).
   * Creates the DB record and executes the backup synchronously.
   */
  async runBackupDirect(
    accountId: string,
    serviceId: string | null,
    storageBackend: string = 'nfs',
  ): Promise<void> {
    const backupId = randomUUID();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = serviceId
      ? `${accountId}-${serviceId}-${timestamp}`
      : `${accountId}-full-${timestamp}`;

    const baseDir = storageBackend === 'nfs' ? NFS_BACKUP_DIR : BACKUP_DIR;
    const backupPath = join(baseDir, accountId, backupName);

    await insertReturning(backups, {
      id: backupId,
      accountId,
      serviceId,
      type: 'manual',
      status: 'pending',
      storagePath: backupPath,
      storageBackend,
      sizeBytes: BigInt(0),
      contents: [],
    });

    await this.runBackup(backupId, accountId, serviceId, backupPath);
  }

  private async runBackup(
    backupId: string,
    accountId: string,
    serviceId: string | null,
    backupPath: string,
  ): Promise<void> {
    // Use a temp directory for archive creation (Docker needs local paths)
    const tempDir = join(tmpdir(), `fleet-backup-${backupId}`);
    const useObjectStorage = this.isObjectStorageAvailable();
    const objectKeyPrefix = `${accountId}/${backupId}`;

    try {
      // Mark as in progress
      await db
        .update(backups)
        .set({ status: 'in_progress' })
        .where(eq(backups.id, backupId));

      // Create working directory (temp if using object storage, backupPath for legacy)
      const workDir = useObjectStorage ? tempDir : backupPath;
      await mkdir(workDir, { recursive: true });

      const contents: Array<{ type: string; name: string; path: string; objectKey?: string }> = [];

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
        const serviceVolumes = (service.volumes as Array<{ source: string; target: string }>) ?? [];
        for (const vol of serviceVolumes) {
          const archiveName = `volume-${vol.source.replace(/[/\\]/g, '_')}.tar.gz`;
          const localArchivePath = join(workDir, archiveName);
          try {
            await this.exec('docker', [
              'run',
              '--rm',
              '-v',
              `${vol.source}:/source:ro`,
              '-v',
              `${workDir}:/backup`,
              'alpine',
              'tar',
              'czf',
              `/backup/${archiveName}`,
              '-C',
              '/source',
              '.',
            ]);

            const objectKey = `${objectKeyPrefix}/${archiveName}`;
            if (useObjectStorage) {
              await this.uploadToObjectStorage(localArchivePath, objectKey);
            }

            contents.push({
              type: 'volume',
              name: vol.source,
              path: useObjectStorage ? objectKey : localArchivePath,
              objectKey: useObjectStorage ? objectKey : undefined,
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
            const archiveName = `volume-${vol.source.replace(/[/\\]/g, '_')}.tar.gz`;
            try {
              await this.exec('docker', [
                'run',
                '--rm',
                '-v',
                `${vol.source}:/source:ro`,
                '-v',
                `${svcDir}:/backup`,
                'alpine',
                'tar',
                'czf',
                `/backup/${archiveName}`,
                '-C',
                '/source',
                '.',
              ]);

              const objectKey = `${objectKeyPrefix}/${service.id}/${archiveName}`;
              if (useObjectStorage) {
                await this.uploadToObjectStorage(join(svcDir, archiveName), objectKey);
              }

              contents.push({
                type: 'volume',
                name: `${service.name}/${vol.source}`,
                path: useObjectStorage ? objectKey : join(svcDir, archiveName),
                objectKey: useObjectStorage ? objectKey : undefined,
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
          sizeBytes: BigInt(sizeBytes),
          storageBackend: useObjectStorage ? 'object' : (backupPath.startsWith(NFS_BACKUP_DIR) ? 'nfs' : 'local'),
          storagePath: useObjectStorage ? objectKeyPrefix : backupPath,
          contents,
        })
        .where(eq(backups.id, backupId));
    } catch (err) {
      logger.error({ err, backupId }, `Backup ${backupId} failed`);
      await db
        .update(backups)
        .set({ status: 'failed' })
        .where(eq(backups.id, backupId));
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
   * Restore from a backup.
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

    const backupContents = (backup.contents as Array<{ type: string; name: string; path: string; objectKey?: string }>) ?? [];
    const isObjectBacked = backup.storageBackend === 'object';
    const tempDir = isObjectBacked ? join(tmpdir(), `fleet-restore-${backupId}`) : null;

    // Mark backup as restoring
    await db
      .update(backups)
      .set({ status: 'restoring' })
      .where(eq(backups.id, backupId));

    try {
      if (tempDir) {
        await mkdir(tempDir, { recursive: true });
      }

      // Restore volume data
      const storagePath = backup.storagePath;
      for (const item of backupContents) {
        if (item.type === 'volume') {
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
            archivePath = join(tempDir!, `${randomUUID()}.tar.gz`);
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
            await this.exec('docker', [
              'run',
              '--rm',
              '-v',
              `${volumeName}:/target`,
              '-v',
              `${archivePath}:/backup/archive.tar.gz:ro`,
              'alpine',
              'sh',
              '-c',
              'cd /target && tar xzf /backup/archive.tar.gz',
            ]);
          } catch (err) {
            logger.error({ err, volume: volumeName }, `Failed to restore volume ${volumeName}`);
          }
        }
      }

      // Mark as completed
      await db
        .update(backups)
        .set({ status: 'completed' })
        .where(eq(backups.id, backupId));

      return { message: 'Backup restored successfully' };
    } catch (err) {
      await db
        .update(backups)
        .set({ status: 'failed' })
        .where(eq(backups.id, backupId));
      throw err;
    } finally {
      // Clean up temp directory
      if (tempDir) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
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
  }) {
    const [schedule] = await insertReturning(backupSchedules, {
      accountId: data.accountId,
      serviceId: data.serviceId ?? null,
      cron: data.cron,
      retentionDays: data.retentionDays ?? 30,
      retentionCount: data.retentionCount ?? 10,
      storageBackend: data.storageBackend ?? 'nfs',
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
    );
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
   */
  private async calculateDirSize(dirPath: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync('du', ['-sb', dirPath]);
      const sizeStr = stdout.trim().split('\t')[0];
      return parseInt(sizeStr ?? '0', 10);
    } catch {
      // Fallback: try stat on the directory itself
      try {
        const stats = await stat(dirPath);
        return Number(stats.size);
      } catch {
        return 0;
      }
    }
  }
}

export const backupService = new BackupService();
