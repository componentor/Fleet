import {
  db,
  storageClusters,
  storageMigrations,
  storageVolumes,
  eq,
  and,
  isNull,
} from '@fleet/db';
import { storageManager } from './storage-manager.js';
import { STORAGE_BUCKETS } from './storage-provider.js';
import type { ObjectStorageProvider, VolumeStorageProvider } from './storage-provider.js';
import { logger } from '../logger.js';

export interface MigrationProgress {
  id: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'rolled_back';
  progress: number;
  totalBytes: number;
  migratedBytes: number;
  currentItem: string | null;
  log: string;
}

/**
 * Storage Migration Service
 *
 * Handles data migration between storage providers:
 * - Volumes: create on target provider, copy content
 * - Objects: stream from source buckets to destination buckets
 * - Progress tracking via storage_migrations table
 * - Supports pause/resume/rollback
 */
class StorageMigrationService {
  private activeMigration: string | null = null;
  private paused = false;

  /**
   * Start a migration between providers.
   * Called from the maintenance worker as a BullMQ job.
   */
  async executeMigration(migrationId: string): Promise<void> {
    if (this.activeMigration) {
      throw new Error('A migration is already in progress');
    }

    const migration = await db.query.storageMigrations.findFirst({
      where: eq(storageMigrations.id, migrationId),
    });

    if (!migration) {
      throw new Error(`Migration ${migrationId} not found`);
    }

    if (migration.status !== 'pending' && migration.status !== 'paused') {
      throw new Error(`Migration ${migrationId} is in status '${migration.status}', expected 'pending' or 'paused'`);
    }

    this.activeMigration = migrationId;
    this.paused = false;

    try {
      await this.updateMigration(migrationId, {
        status: 'running',
        startedAt: migration.startedAt ?? new Date(),
      });

      // Phase 1: Inventory
      await this.appendLog(migrationId, 'Starting inventory...');
      const inventory = await this.buildInventory();
      const totalBytes = inventory.totalBytes;

      await this.updateMigration(migrationId, {
        totalBytes,
        currentItem: 'Inventorying complete',
      });
      await this.appendLog(migrationId, `Inventory: ${inventory.volumes.length} volumes, ${inventory.buckets.length} buckets, ${this.formatBytes(totalBytes)} total`);

      // Phase 2: Initialize target providers
      await this.appendLog(migrationId, `Initializing target providers: volumes=${migration.toProvider}`);
      const targetVolume = await this.loadVolumeProvider(migration.toProvider);
      await targetVolume.initialize();

      // For object migration, check if we have a different target too
      // (The migration record stores toProvider for volumes; objects are migrated alongside)
      const cluster = await db.query.storageClusters.findFirst();
      const currentObjectProvider = cluster?.objectProvider ?? 'local';

      let targetObject: ObjectStorageProvider | null = null;
      if (migration.toProvider !== currentObjectProvider) {
        // If switching to distributed volumes, also switch objects
        const objectTarget = migration.toProvider === 'glusterfs' ? 'minio' : 'local';
        targetObject = await this.loadObjectProvider(objectTarget);
        await targetObject.initialize();
        await this.appendLog(migrationId, `Object provider target: ${objectTarget}`);
      }

      let migratedBytes = migration.migratedBytes ?? 0;

      // Phase 3: Migrate volumes
      if (inventory.volumes.length > 0) {
        await this.appendLog(migrationId, `Migrating ${inventory.volumes.length} volume(s)...`);

        for (const vol of inventory.volumes) {
          if (this.paused) {
            await this.updateMigration(migrationId, {
              status: 'paused',
              migratedBytes,
              currentItem: `Paused at volume: ${vol.name}`,
            });
            await this.appendLog(migrationId, 'Migration paused by user');
            return;
          }

          await this.updateMigration(migrationId, {
            currentItem: `Volume: ${vol.displayName ?? vol.name}`,
          });
          await this.appendLog(migrationId, `Migrating volume: ${vol.name} (${vol.sizeGb} GB)`);

          try {
            // Create volume on target provider
            await targetVolume.createVolume(vol.name, vol.sizeGb);

            // For volume data copy, we rely on rsync or similar at the OS level.
            // The providers abstract the path — copy files from source path to target path.
            const sourceInfo = await storageManager.volumes.getVolumeInfo(vol.name);
            const targetInfo = await targetVolume.getVolumeInfo(vol.name);

            if (sourceInfo.path && targetInfo.path) {
              await this.copyDirectory(sourceInfo.path, targetInfo.path);
            }

            migratedBytes += vol.sizeGb * 1024 * 1024 * 1024;
            const progress = totalBytes > 0 ? Math.round((migratedBytes / totalBytes) * 100) : 0;

            await this.updateMigration(migrationId, {
              migratedBytes,
              progress: Math.min(progress, 99),
            });
            await this.appendLog(migrationId, `Volume ${vol.name} migrated successfully`);
          } catch (err) {
            await this.appendLog(migrationId, `ERROR migrating volume ${vol.name}: ${err}`);
            logger.error({ err, volume: vol.name }, 'Volume migration failed');
            // Continue with other volumes — don't fail the whole migration
          }
        }
      }

      // Phase 4: Migrate objects (buckets)
      if (targetObject && inventory.buckets.length > 0) {
        await this.appendLog(migrationId, `Migrating ${inventory.buckets.length} bucket(s)...`);

        for (const bucket of inventory.buckets) {
          if (this.paused) {
            await this.updateMigration(migrationId, {
              status: 'paused',
              migratedBytes,
              currentItem: `Paused at bucket: ${bucket.name}`,
            });
            await this.appendLog(migrationId, 'Migration paused by user');
            return;
          }

          await this.updateMigration(migrationId, {
            currentItem: `Bucket: ${bucket.name}`,
          });
          await this.appendLog(migrationId, `Migrating bucket: ${bucket.name} (${bucket.objects.length} objects)`);

          // Ensure bucket exists on target
          await targetObject.ensureBucket(bucket.name);

          for (const obj of bucket.objects) {
            if (this.paused) {
              await this.updateMigration(migrationId, { status: 'paused', migratedBytes });
              return;
            }

            try {
              const stream = await storageManager.objects.getObject(bucket.name, obj.key);
              await targetObject.putObject(bucket.name, obj.key, stream as any, obj.size);

              migratedBytes += obj.size;
              const progress = totalBytes > 0 ? Math.round((migratedBytes / totalBytes) * 100) : 0;

              await this.updateMigration(migrationId, {
                migratedBytes,
                progress: Math.min(progress, 99),
                currentItem: `${bucket.name}/${obj.key}`,
              });
            } catch (err) {
              await this.appendLog(migrationId, `ERROR migrating ${bucket.name}/${obj.key}: ${err}`);
              logger.error({ err, bucket: bucket.name, key: obj.key }, 'Object migration failed');
            }
          }

          await this.appendLog(migrationId, `Bucket ${bucket.name} migrated`);
        }
      }

      // Phase 5: Verify
      await this.appendLog(migrationId, 'Verifying migration...');
      await this.updateMigration(migrationId, { currentItem: 'Verifying...' });

      // Basic verification: check volume count on target
      const targetVolumes = await targetVolume.listVolumes();
      const expectedCount = inventory.volumes.length;
      if (targetVolumes.length < expectedCount) {
        await this.appendLog(migrationId, `WARNING: Expected ${expectedCount} volumes on target, found ${targetVolumes.length}`);
      }

      // Phase 6: Switchover — update cluster config to use new provider
      await this.appendLog(migrationId, 'Switching active provider...');

      const clusterRecord = await db.query.storageClusters.findFirst();
      if (clusterRecord) {
        const objectProvider = targetObject
          ? (migration.toProvider === 'glusterfs' ? 'minio' : 'local')
          : clusterRecord.objectProvider;

        await db.update(storageClusters).set({
          provider: migration.toProvider,
          objectProvider,
          updatedAt: new Date(),
        }).where(eq(storageClusters.id, clusterRecord.id));
      }

      // Reload storage manager with new config
      await storageManager.reload();

      // Update volume records in DB to reflect new provider
      for (const vol of inventory.volumes) {
        await db.update(storageVolumes).set({
          provider: migration.toProvider,
          updatedAt: new Date(),
        }).where(and(
          eq(storageVolumes.name, vol.name),
          isNull(storageVolumes.deletedAt),
        ));
      }

      // Complete
      await this.updateMigration(migrationId, {
        status: 'completed',
        progress: 100,
        migratedBytes: totalBytes,
        currentItem: null,
        completedAt: new Date(),
      });
      await this.appendLog(migrationId, `Migration completed. ${this.formatBytes(totalBytes)} migrated.`);

      logger.info({ migrationId, totalBytes }, 'Storage migration completed successfully');
    } catch (err) {
      logger.error({ err, migrationId }, 'Storage migration failed');
      await this.updateMigration(migrationId, {
        status: 'failed',
        currentItem: `Error: ${err}`,
      });
      await this.appendLog(migrationId, `FATAL: Migration failed — ${err}`);
    } finally {
      this.activeMigration = null;
    }
  }

  /**
   * Pause a running migration.
   */
  async pauseMigration(migrationId: string): Promise<void> {
    if (this.activeMigration !== migrationId) {
      // Not running locally — just update DB status
      await this.updateMigration(migrationId, { status: 'paused' });
      return;
    }
    this.paused = true;
  }

  /**
   * Resume a paused migration.
   * Re-queues the migration as a maintenance job.
   */
  async resumeMigration(migrationId: string): Promise<void> {
    const migration = await db.query.storageMigrations.findFirst({
      where: eq(storageMigrations.id, migrationId),
    });

    if (!migration || migration.status !== 'paused') {
      throw new Error('Migration is not paused');
    }

    await this.updateMigration(migrationId, { status: 'pending' });
  }

  /**
   * Rollback a migration — switch config back to the previous provider.
   * The old data is still there since we don't delete source data during migration.
   */
  async rollbackMigration(migrationId: string): Promise<void> {
    const migration = await db.query.storageMigrations.findFirst({
      where: eq(storageMigrations.id, migrationId),
    });

    if (!migration) {
      throw new Error('Migration not found');
    }

    // Switch back to the original provider
    const clusterRecord = await db.query.storageClusters.findFirst();
    if (clusterRecord) {
      await db.update(storageClusters).set({
        provider: migration.fromProvider,
        updatedAt: new Date(),
      }).where(eq(storageClusters.id, clusterRecord.id));
    }

    // Reload storage manager
    await storageManager.reload();

    // Revert volume records
    const volumes = await db.query.storageVolumes.findMany({
      where: isNull(storageVolumes.deletedAt),
    });

    for (const vol of volumes) {
      await db.update(storageVolumes).set({
        provider: migration.fromProvider,
        updatedAt: new Date(),
      }).where(eq(storageVolumes.id, vol.id));
    }

    await this.updateMigration(migrationId, {
      status: 'rolled_back',
      completedAt: new Date(),
    });
    await this.appendLog(migrationId, `Migration rolled back to ${migration.fromProvider}`);
  }

  /**
   * Get migration progress for the UI.
   */
  async getProgress(migrationId: string): Promise<MigrationProgress | null> {
    const migration = await db.query.storageMigrations.findFirst({
      where: eq(storageMigrations.id, migrationId),
    });

    if (!migration) return null;

    return {
      id: migration.id,
      status: migration.status as MigrationProgress['status'],
      progress: migration.progress ?? 0,
      totalBytes: migration.totalBytes ?? 0,
      migratedBytes: migration.migratedBytes ?? 0,
      currentItem: migration.currentItem ?? null,
      log: migration.log ?? '',
    };
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private async buildInventory() {
    const volumes = await db.query.storageVolumes.findMany({
      where: isNull(storageVolumes.deletedAt),
    });

    let totalBytes = 0;

    // Sum volume sizes
    for (const vol of volumes) {
      totalBytes += vol.sizeGb * 1024 * 1024 * 1024;
    }

    // List objects in each standard bucket
    const buckets: Array<{ name: string; objects: Array<{ key: string; size: number }> }> = [];

    for (const bucketName of Object.values(STORAGE_BUCKETS)) {
      try {
        const objects = await storageManager.objects.listObjects(bucketName);
        const bucketObjects = objects.map((o) => ({ key: o.key, size: o.size }));
        const bucketSize = bucketObjects.reduce((sum, o) => sum + o.size, 0);
        totalBytes += bucketSize;
        buckets.push({ name: bucketName, objects: bucketObjects });
      } catch {
        // Bucket may not exist yet
        buckets.push({ name: bucketName, objects: [] });
      }
    }

    return { volumes, buckets, totalBytes };
  }

  private async loadVolumeProvider(provider: string): Promise<VolumeStorageProvider> {
    const cluster = await db.query.storageClusters.findFirst();
    const config = (cluster?.config as Record<string, any>) ?? {};

    switch (provider) {
      case 'glusterfs': {
        const { GlusterFSVolumeProvider } = await import('./providers/glusterfs-volume.provider.js');
        return new GlusterFSVolumeProvider(config);
      }
      case 'ceph': {
        const { CephVolumeProvider } = await import('./providers/ceph-volume.provider.js');
        return new CephVolumeProvider(config);
      }
      case 'local':
      default: {
        const { LocalVolumeProvider } = await import('./providers/local-volume.provider.js');
        return new LocalVolumeProvider();
      }
    }
  }

  private async loadObjectProvider(provider: string): Promise<ObjectStorageProvider> {
    const cluster = await db.query.storageClusters.findFirst();
    const objectConfig = (cluster?.objectConfig as Record<string, any>) ?? {};

    switch (provider) {
      case 'minio': {
        const { MinIOObjectProvider } = await import('./providers/minio-object.provider.js');
        return new MinIOObjectProvider(objectConfig);
      }
      case 's3': {
        const { S3ObjectProvider } = await import('./providers/s3-object.provider.js');
        return new S3ObjectProvider(objectConfig);
      }
      case 'gcs': {
        const { GCSObjectProvider } = await import('./providers/gcs-object.provider.js');
        return new GCSObjectProvider(objectConfig);
      }
      case 'local':
      default: {
        const { LocalObjectProvider } = await import('./providers/local-object.provider.js');
        return new LocalObjectProvider();
      }
    }
  }

  private async copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
    const { resolve } = await import('node:path');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);

    // Validate paths — must be absolute, no traversal, no shell metacharacters
    const resolvedSource = resolve(sourcePath);
    const resolvedTarget = resolve(targetPath);

    if (resolvedSource !== sourcePath || resolvedTarget !== targetPath) {
      throw new Error('Path traversal detected in migration copy');
    }

    // Block dangerous paths
    const blockedPrefixes = ['/', '/bin', '/sbin', '/usr', '/etc', '/dev', '/proc', '/sys', '/boot', '/root', '/home'];
    for (const blocked of blockedPrefixes) {
      if (resolvedSource === blocked || resolvedTarget === blocked) {
        throw new Error(`Refusing to copy to/from system path: ${blocked}`);
      }
    }

    // Reject paths with shell metacharacters (even though execFile is safe, defense-in-depth)
    const shellMetaRe = /[;&|`$"'\\]/;
    if (shellMetaRe.test(resolvedSource) || shellMetaRe.test(resolvedTarget)) {
      throw new Error('Invalid characters in copy path');
    }

    // Use rsync for efficient directory copy with progress
    try {
      await execFileAsync('rsync', ['-a', '--delete', `${resolvedSource}/`, `${resolvedTarget}/`], {
        timeout: 30 * 60 * 1000, // 30 minute timeout per volume
      });
    } catch (err: any) {
      // Fall back to cp if rsync is not available
      if (err?.code === 'ENOENT') {
        await execFileAsync('cp', ['-a', `${resolvedSource}/.`, resolvedTarget], {
          timeout: 30 * 60 * 1000,
        });
      } else {
        throw err;
      }
    }
  }

  private async updateMigration(id: string, fields: Record<string, any>): Promise<void> {
    await db.update(storageMigrations).set(fields).where(eq(storageMigrations.id, id));
  }

  private async appendLog(id: string, message: string): Promise<void> {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${message}\n`;

    const migration = await db.query.storageMigrations.findFirst({
      where: eq(storageMigrations.id, id),
      columns: { log: true },
    });

    const currentLog = migration?.log ?? '';
    await db.update(storageMigrations).set({
      log: currentLog + line,
    }).where(eq(storageMigrations.id, id));

    logger.info({ migrationId: id }, message);
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }
}

export const migrationService = new StorageMigrationService();
