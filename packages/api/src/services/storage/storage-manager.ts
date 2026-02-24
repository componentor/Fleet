import { db, storageClusters, storageVolumes, resourceLimits, eq, and, isNull, sql } from '@fleet/db';
import { logger } from '../logger.js';
import type {
  VolumeStorageProvider,
  ObjectStorageProvider,
  VolumeResult,
  VolumeInfo,
  StorageHealth,
} from './storage-provider.js';
import { STORAGE_BUCKETS } from './storage-provider.js';
import { LocalVolumeProvider } from './providers/local-volume.provider.js';
import { LocalObjectProvider } from './providers/local-object.provider.js';

export interface StorageClusterConfig {
  provider: string;
  objectProvider: string;
  status: string;
  replicationFactor: number;
  config: Record<string, any>;
  objectConfig: Record<string, any>;
}

/**
 * Storage Manager — singleton orchestrator for all storage operations.
 *
 * Reads cluster config from DB (or defaults to 'local') and instantiates
 * the correct volume and object providers. All services should call
 * storageManager.volumes / storageManager.objects instead of using
 * NFS/filesystem directly.
 */
class StorageManager {
  private volumeProvider!: VolumeStorageProvider;
  private objectProvider!: ObjectStorageProvider;
  private initialized = false;
  private clusterConfig: StorageClusterConfig | null = null;

  get volumes(): VolumeStorageProvider {
    if (!this.initialized) throw new Error('StorageManager not initialized');
    return this.volumeProvider;
  }

  get objects(): ObjectStorageProvider {
    if (!this.initialized) throw new Error('StorageManager not initialized');
    return this.objectProvider;
  }

  get config(): StorageClusterConfig | null {
    return this.clusterConfig;
  }

  get isDistributed(): boolean {
    return this.clusterConfig?.provider !== 'local' || this.clusterConfig?.objectProvider !== 'local';
  }

  /** Whether the volume provider specifically is distributed (affects platform volumes). */
  get isVolumeDistributed(): boolean {
    return !!this.clusterConfig && this.clusterConfig.provider !== 'local';
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load cluster config from DB
    let cluster: any;
    try {
      cluster = await db.query.storageClusters.findFirst();
    } catch {
      // Table may not exist yet (before migration)
    }

    if (cluster) {
      this.clusterConfig = {
        provider: cluster.provider,
        objectProvider: cluster.objectProvider,
        status: cluster.status,
        replicationFactor: cluster.replicationFactor ?? 3,
        config: (cluster.config as Record<string, any>) ?? {},
        objectConfig: (cluster.objectConfig as Record<string, any>) ?? {},
      };
    } else {
      this.clusterConfig = {
        provider: 'local',
        objectProvider: 'local',
        status: 'healthy',
        replicationFactor: 1,
        config: {},
        objectConfig: {},
      };
    }

    // Instantiate providers based on config
    await this.loadProviders();

    this.initialized = true;
    logger.info(
      { volumeProvider: this.volumeProvider.name, objectProvider: this.objectProvider.name },
      'Storage manager initialized',
    );
  }

  /** Re-initialize after a config change (e.g. switching providers). */
  async reload(): Promise<void> {
    this.initialized = false;
    await this.initialize();
  }

  // ── Volume operations with quota enforcement ────────────────────────────

  /**
   * Create a volume with quota enforcement.
   * Checks account storage limits before creating.
   */
  async createVolume(
    accountId: string,
    name: string,
    displayName: string,
    sizeGb: number,
    nodeId?: string,
  ): Promise<VolumeResult> {
    // Check account storage quota
    await this.enforceStorageQuota(accountId, sizeGb);

    const result = await this.volumeProvider.createVolume(name, sizeGb, nodeId);

    // Track in DB
    await db.insert(storageVolumes).values({
      accountId,
      name,
      displayName,
      sizeGb,
      provider: this.volumeProvider.name,
      providerVolumeId: result.name,
      mountPath: result.path,
      replicaCount: this.clusterConfig?.replicationFactor ?? 1,
      status: 'ready',
    });

    return result;
  }

  /**
   * Delete a volume and remove its DB record.
   */
  async deleteVolume(accountId: string, name: string): Promise<void> {
    await this.volumeProvider.deleteVolume(name);

    await db.update(storageVolumes)
      .set({ deletedAt: new Date(), status: 'deleting', updatedAt: new Date() })
      .where(and(
        eq(storageVolumes.name, name),
        eq(storageVolumes.accountId, accountId),
        isNull(storageVolumes.deletedAt),
      ));
  }

  /**
   * List volumes for an account.
   */
  async listAccountVolumes(accountId: string): Promise<VolumeInfo[]> {
    const dbVolumes = await db.query.storageVolumes.findMany({
      where: and(
        eq(storageVolumes.accountId, accountId),
        isNull(storageVolumes.deletedAt),
      ),
    });

    // Enrich with live usage data from provider
    const results: VolumeInfo[] = [];
    for (const v of dbVolumes) {
      try {
        const live = await this.volumeProvider.getVolumeInfo(v.name);
        results.push({
          ...live,
          replicaCount: v.replicaCount ?? 1,
          status: v.status,
        });
      } catch {
        results.push({
          name: v.name,
          path: v.mountPath ?? '',
          sizeGb: v.sizeGb,
          usedGb: v.usedGb ?? 0,
          availableGb: v.sizeGb - (v.usedGb ?? 0),
          replicaCount: v.replicaCount ?? 1,
          status: v.status,
        });
      }
    }

    return results;
  }

  /**
   * Get total storage used by an account (in GB).
   */
  async getAccountStorageUsage(accountId: string): Promise<number> {
    const result = await db
      .select({ total: sql<number>`coalesce(sum(${storageVolumes.sizeGb}), 0)` })
      .from(storageVolumes)
      .where(and(
        eq(storageVolumes.accountId, accountId),
        isNull(storageVolumes.deletedAt),
      ));
    return result[0]?.total ?? 0;
  }

  /**
   * Get the storage quota for an account (in GB).
   * Returns global limit or account-specific override.
   */
  async getAccountStorageLimit(accountId: string): Promise<number> {
    // Check account-specific limit first
    const accountLimit = await db.query.resourceLimits.findFirst({
      where: eq(resourceLimits.accountId, accountId),
    });
    if (accountLimit?.maxNfsStorageGb) return accountLimit.maxNfsStorageGb;

    // Fall back to global limit
    const globalLimit = await db.query.resourceLimits.findFirst({
      where: isNull(resourceLimits.accountId),
    });
    return globalLimit?.maxNfsStorageGb ?? 100; // Default 100 GB
  }

  // ── Health ──────────────────────────────────────────────────────────────

  async getHealth(): Promise<{ volumes: StorageHealth; objects: StorageHealth }> {
    if (!this.initialized || !this.volumeProvider || !this.objectProvider) {
      return {
        volumes: { status: 'error', provider: 'unknown', message: 'Storage manager not initialized' },
        objects: { status: 'error', provider: 'unknown', message: 'Storage manager not initialized' },
      };
    }
    const [volumeHealth, objectHealth] = await Promise.all([
      this.volumeProvider.getHealth(),
      this.objectProvider.getHealth(),
    ]);
    return { volumes: volumeHealth, objects: objectHealth };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async loadProviders(): Promise<void> {
    const volumeType = this.clusterConfig?.provider ?? 'local';
    const objectType = this.clusterConfig?.objectProvider ?? 'local';

    // Volume provider
    switch (volumeType) {
      case 'glusterfs': {
        const { GlusterFSVolumeProvider } = await import('./providers/glusterfs-volume.provider.js');
        this.volumeProvider = new GlusterFSVolumeProvider(this.clusterConfig!.config);
        break;
      }
      case 'ceph': {
        const { CephVolumeProvider } = await import('./providers/ceph-volume.provider.js');
        this.volumeProvider = new CephVolumeProvider(this.clusterConfig!.config);
        break;
      }
      case 'local':
      default:
        this.volumeProvider = new LocalVolumeProvider();
        break;
    }

    // Object provider
    switch (objectType) {
      case 'minio': {
        const { MinIOObjectProvider } = await import('./providers/minio-object.provider.js');
        this.objectProvider = new MinIOObjectProvider(this.clusterConfig!.objectConfig);
        break;
      }
      case 's3': {
        const { S3ObjectProvider } = await import('./providers/s3-object.provider.js');
        this.objectProvider = new S3ObjectProvider(this.clusterConfig!.objectConfig);
        break;
      }
      case 'gcs': {
        const { GCSObjectProvider } = await import('./providers/gcs-object.provider.js');
        this.objectProvider = new GCSObjectProvider(this.clusterConfig!.objectConfig);
        break;
      }
      case 'local':
      default:
        this.objectProvider = new LocalObjectProvider();
        break;
    }

    // Initialize providers
    await this.volumeProvider.initialize();
    await this.objectProvider.initialize();

    // Ensure default buckets exist
    for (const bucket of Object.values(STORAGE_BUCKETS)) {
      await this.objectProvider.ensureBucket(bucket).catch((err) => {
        logger.warn({ err, bucket }, 'Failed to ensure bucket');
      });
    }
  }

  private async enforceStorageQuota(accountId: string, requestedGb: number): Promise<void> {
    const [currentUsage, limit] = await Promise.all([
      this.getAccountStorageUsage(accountId),
      this.getAccountStorageLimit(accountId),
    ]);

    if (currentUsage + requestedGb > limit) {
      throw new Error(
        `Storage quota exceeded: using ${currentUsage} GB of ${limit} GB limit, requested ${requestedGb} GB`,
      );
    }
  }
}

export const storageManager = new StorageManager();
