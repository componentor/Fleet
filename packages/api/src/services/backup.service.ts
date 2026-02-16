import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, backups, backupSchedules, services, insertReturning, updateReturning, deleteReturning, eq, and } from '@fleet/db';

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
      ? `${accountId.slice(0, 8)}-${serviceId.slice(0, 8)}-${timestamp}`
      : `${accountId.slice(0, 8)}-full-${timestamp}`;

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

    // Run backup asynchronously
    this.runBackup(backupId, accountId, serviceId ?? null, backupPath).catch(
      (err) => {
        console.error(`Backup ${backupId} failed:`, err);
      },
    );

    return {
      id: backup.id,
      status: 'pending',
      storagePath: backupPath,
      sizeBytes: BigInt(0),
    };
  }

  private async runBackup(
    backupId: string,
    accountId: string,
    serviceId: string | null,
    backupPath: string,
  ): Promise<void> {
    try {
      // Mark as in progress
      await db
        .update(backups)
        .set({ status: 'in_progress' })
        .where(eq(backups.id, backupId));

      // Ensure backup directory exists
      await mkdir(backupPath, { recursive: true });

      const contents: Array<{ type: string; name: string; path: string }> = [];

      if (serviceId) {
        // Backup a specific service
        const service = await db.query.services.findFirst({
          where: and(
            eq(services.id, serviceId),
            eq(services.accountId, accountId),
          ),
        });

        if (!service) {
          throw new Error(`Service ${serviceId} not found for account ${accountId}`);
        }

        // Backup service volumes
        const serviceVolumes = (service.volumes as Array<{ source: string; target: string }>) ?? [];
        for (const vol of serviceVolumes) {
          const volumeBackupPath = join(backupPath, `volume-${vol.source.replace(/[/\\]/g, '_')}.tar.gz`);
          try {
            await this.exec('docker', [
              'run',
              '--rm',
              '-v',
              `${vol.source}:/source:ro`,
              '-v',
              `${backupPath}:/backup`,
              'alpine',
              'tar',
              'czf',
              `/backup/volume-${vol.source.replace(/[/\\]/g, '_')}.tar.gz`,
              '-C',
              '/source',
              '.',
            ]);
            contents.push({
              type: 'volume',
              name: vol.source,
              path: volumeBackupPath,
            });
          } catch (err) {
            console.error(`Failed to backup volume ${vol.source}:`, err);
          }
        }

        // Export service metadata as JSON
        const metadataPath = join(backupPath, 'service-metadata.json');
        const metadata = {
          service: {
            id: service.id,
            name: service.name,
            image: service.image,
            env: service.env,
            ports: service.ports,
            volumes: service.volumes,
            domain: service.domain,
            replicas: service.replicas,
          },
          timestamp: new Date().toISOString(),
        };

        await this.exec('sh', [
          '-c',
          `echo '${JSON.stringify(metadata).replace(/'/g, "'\\''")}' > "${metadataPath}"`,
        ]);
        contents.push({ type: 'metadata', name: 'service-metadata.json', path: metadataPath });
      } else {
        // Full account backup — backup all services
        const accountServices = await db.query.services.findMany({
          where: eq(services.accountId, accountId),
        });

        for (const service of accountServices) {
          const svcDir = join(backupPath, service.id);
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
              contents.push({
                type: 'volume',
                name: `${service.name}/${vol.source}`,
                path: join(svcDir, archiveName),
              });
            } catch (err) {
              console.error(
                `Failed to backup volume ${vol.source} for service ${service.name}:`,
                err,
              );
            }
          }
        }

        // Export account-wide metadata
        const metadataPath = join(backupPath, 'account-metadata.json');
        const metadata = {
          services: accountServices.map((s) => ({
            id: s.id,
            name: s.name,
            image: s.image,
            env: s.env,
            ports: s.ports,
            volumes: s.volumes,
            domain: s.domain,
            replicas: s.replicas,
          })),
          timestamp: new Date().toISOString(),
        };

        await this.exec('sh', [
          '-c',
          `echo '${JSON.stringify(metadata).replace(/'/g, "'\\''")}' > "${metadataPath}"`,
        ]);
        contents.push({ type: 'metadata', name: 'account-metadata.json', path: metadataPath });
      }

      // Calculate total size
      const sizeBytes = await this.calculateDirSize(backupPath);

      // Mark as completed
      await db
        .update(backups)
        .set({
          status: 'completed',
          sizeBytes: BigInt(sizeBytes),
          contents,
        })
        .where(eq(backups.id, backupId));
    } catch (err) {
      console.error(`Backup ${backupId} failed:`, err);
      await db
        .update(backups)
        .set({ status: 'failed' })
        .where(eq(backups.id, backupId));
    }
  }

  /**
   * Restore from a backup.
   */
  async restoreBackup(backupId: string): Promise<{ message: string }> {
    const backup = await db.query.backups.findFirst({
      where: eq(backups.id, backupId),
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

    const backupContents = (backup.contents as Array<{ type: string; name: string; path: string }>) ?? [];

    // Mark backup as restoring
    await db
      .update(backups)
      .set({ status: 'restoring' })
      .where(eq(backups.id, backupId));

    try {
      // Restore volume data
      for (const item of backupContents) {
        if (item.type === 'volume') {
          // Extract volume name from the content entry
          const volumeName = item.name.includes('/')
            ? item.name.split('/').pop()!
            : item.name;

          try {
            await this.exec('docker', [
              'run',
              '--rm',
              '-v',
              `${volumeName}:/target`,
              '-v',
              `${item.path}:/backup/archive.tar.gz:ro`,
              'alpine',
              'sh',
              '-c',
              'cd /target && tar xzf /backup/archive.tar.gz',
            ]);
          } catch (err) {
            console.error(`Failed to restore volume ${volumeName}:`, err);
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
        .set({ status: 'completed' })
        .where(eq(backups.id, backupId));
      throw err;
    }
  }

  /**
   * Delete a backup and its storage files.
   */
  async deleteBackup(backupId: string): Promise<boolean> {
    const backup = await db.query.backups.findFirst({
      where: eq(backups.id, backupId),
    });

    if (!backup) {
      return false;
    }

    // Remove files from disk
    if (backup.storagePath) {
      try {
        await rm(backup.storagePath, { recursive: true, force: true });
      } catch (err) {
        console.error(`Failed to remove backup files at ${backup.storagePath}:`, err);
      }
    }

    // Remove DB record
    const result = await deleteReturning(
      backups,
      eq(backups.id, backupId),
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
  async listSchedules(accountId: string) {
    return db.query.backupSchedules.findMany({
      where: eq(backupSchedules.accountId, accountId),
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
