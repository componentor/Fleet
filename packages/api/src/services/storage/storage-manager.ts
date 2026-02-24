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

export interface ClusterEntry {
  id: string;
  name: string;
  region: string | null;
  scope: string;
  config: StorageClusterConfig;
  volumeProvider: VolumeStorageProvider;
  objectProvider: ObjectStorageProvider;
}

/**
 * Storage Manager — orchestrator for multi-cluster storage operations.
 *
 * Loads all storage clusters from DB and instantiates the correct volume and
 * object providers for each. Supports regional clusters (data stays in one
 * geography) and global clusters (geo-replicated, slow writes, fast local reads).
 *
 * Backwards-compatible: `storageManager.volumes` / `storageManager.objects`
 * return the default cluster's providers. Use `getClusterForRegion()` to
 * resolve to the best cluster for a given region.
 */
class StorageManager {
  private clusters = new Map<string, ClusterEntry>();
  private defaultClusterId: string | null = null;
  private initialized = false;

  // ── Backwards-compatible getters (default cluster) ─────────────────────

  get volumes(): VolumeStorageProvider {
    if (!this.initialized) throw new Error('StorageManager not initialized');
    const entry = this.getDefaultCluster();
    return entry.volumeProvider;
  }

  get objects(): ObjectStorageProvider {
    if (!this.initialized) throw new Error('StorageManager not initialized');
    const entry = this.getDefaultCluster();
    return entry.objectProvider;
  }

  get config(): StorageClusterConfig | null {
    const entry = this.defaultClusterId ? this.clusters.get(this.defaultClusterId) : undefined;
    return entry?.config ?? null;
  }

  get isDistributed(): boolean {
    return this.config?.provider !== 'local' || this.config?.objectProvider !== 'local';
  }

  /** Whether the default volume provider is distributed (affects platform volumes). */
  get isVolumeDistributed(): boolean {
    return !!this.config && this.config.provider !== 'local';
  }

  // ── Multi-cluster accessors ────────────────────────────────────────────

  getCluster(id: string): ClusterEntry | undefined {
    return this.clusters.get(id);
  }

  getAllClusters(): ClusterEntry[] {
    return Array.from(this.clusters.values());
  }

  /**
   * Resolve the best cluster for a given region.
   *
   * Resolution order:
   * 1. If `region` is set → find a cluster with `scope = 'regional'` and matching `region`
   * 2. If no regional match → fall back to any `scope = 'global'` cluster
   * 3. If nothing → fall back to `defaultClusterId`
   */
  getClusterForRegion(region: string | null): ClusterEntry | undefined {
    if (region) {
      // 1. Try regional match
      for (const entry of this.clusters.values()) {
        if (entry.scope === 'regional' && entry.region === region) {
          return entry;
        }
      }
    }

    // 2. Try global cluster
    for (const entry of this.clusters.values()) {
      if (entry.scope === 'global') {
        return entry;
      }
    }

    // 3. Fall back to default
    return this.defaultClusterId ? this.clusters.get(this.defaultClusterId) : undefined;
  }

  // ── Initialization ─────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Load all cluster configs from DB
    let dbClusters: any[] = [];
    try {
      dbClusters = await db.query.storageClusters.findMany();
    } catch {
      // Table may not exist yet (before migration)
    }

    if (dbClusters.length > 0) {
      for (const cluster of dbClusters) {
        const clusterConfig: StorageClusterConfig = {
          provider: cluster.provider,
          objectProvider: cluster.objectProvider,
          status: cluster.status,
          replicationFactor: cluster.replicationFactor ?? 3,
          config: (cluster.config as Record<string, any>) ?? {},
          objectConfig: (cluster.objectConfig as Record<string, any>) ?? {},
        };

        const { volumeProvider, objectProvider } = await this.loadProviders(clusterConfig);

        this.clusters.set(cluster.id, {
          id: cluster.id,
          name: cluster.name ?? 'default',
          region: cluster.region ?? null,
          scope: cluster.scope ?? 'regional',
          config: clusterConfig,
          volumeProvider,
          objectProvider,
        });

        logger.info(
          {
            clusterId: cluster.id,
            name: cluster.name,
            region: cluster.region,
            scope: cluster.scope,
            volumeProvider: volumeProvider.name,
            objectProvider: objectProvider.name,
          },
          'Storage cluster initialized',
        );
      }

      // Default = first cluster (backwards compatible)
      this.defaultClusterId = dbClusters[0].id;
    } else {
      // No clusters in DB — create an in-memory local fallback
      const fallbackId = '__local__';
      const fallbackConfig: StorageClusterConfig = {
        provider: 'local',
        objectProvider: 'local',
        status: 'healthy',
        replicationFactor: 1,
        config: {},
        objectConfig: {},
      };

      const volumeProvider = new LocalVolumeProvider();
      const objectProvider = new LocalObjectProvider();
      await volumeProvider.initialize();
      await objectProvider.initialize();

      for (const bucket of Object.values(STORAGE_BUCKETS)) {
        await objectProvider.ensureBucket(bucket).catch((err) => {
          logger.warn({ err, bucket }, 'Failed to ensure bucket');
        });
      }

      this.clusters.set(fallbackId, {
        id: fallbackId,
        name: 'default',
        region: null,
        scope: 'regional',
        config: fallbackConfig,
        volumeProvider,
        objectProvider,
      });

      this.defaultClusterId = fallbackId;
    }

    this.initialized = true;
    const defaultEntry = this.clusters.get(this.defaultClusterId!);
    logger.info(
      {
        clusterCount: this.clusters.size,
        defaultCluster: this.defaultClusterId,
        volumeProvider: defaultEntry?.volumeProvider.name,
        objectProvider: defaultEntry?.objectProvider.name,
      },
      'Storage manager initialized',
    );
  }

  /** Re-initialize all clusters after a config change. */
  async reload(): Promise<void> {
    this.clusters.clear();
    this.defaultClusterId = null;
    this.initialized = false;
    await this.initialize();
  }

  /** Re-initialize a single cluster after its config changes. */
  async reloadCluster(clusterId: string): Promise<void> {
    const cluster = await db.query.storageClusters.findFirst({
      where: eq(storageClusters.id, clusterId),
    });
    if (!cluster) {
      this.clusters.delete(clusterId);
      return;
    }

    const clusterConfig: StorageClusterConfig = {
      provider: cluster.provider,
      objectProvider: cluster.objectProvider,
      status: cluster.status,
      replicationFactor: cluster.replicationFactor ?? 3,
      config: (cluster.config as Record<string, any>) ?? {},
      objectConfig: (cluster.objectConfig as Record<string, any>) ?? {},
    };

    const { volumeProvider, objectProvider } = await this.loadProviders(clusterConfig);

    this.clusters.set(cluster.id, {
      id: cluster.id,
      name: cluster.name ?? 'default',
      region: cluster.region ?? null,
      scope: cluster.scope ?? 'regional',
      config: clusterConfig,
      volumeProvider,
      objectProvider,
    });
  }

  // ── Volume operations with quota enforcement ────────────────────────────

  /**
   * Create a volume with quota enforcement.
   * Checks account storage limits before creating.
   * If `region` is provided, the volume is created on the best matching cluster.
   */
  async createVolume(
    accountId: string,
    name: string,
    displayName: string,
    sizeGb: number,
    nodeId?: string,
    region?: string | null,
  ): Promise<VolumeResult> {
    // Check account storage quota
    await this.enforceStorageQuota(accountId, sizeGb);

    // Resolve cluster
    const cluster = this.getClusterForRegion(region ?? null) ?? this.getDefaultCluster();
    const result = await cluster.volumeProvider.createVolume(name, sizeGb, nodeId);

    // Track in DB
    await db.insert(storageVolumes).values({
      accountId,
      name,
      displayName,
      sizeGb,
      clusterId: cluster.id === '__local__' ? null : cluster.id,
      provider: cluster.volumeProvider.name,
      providerVolumeId: result.name,
      mountPath: result.path,
      replicaCount: cluster.config.replicationFactor ?? 1,
      status: 'ready',
    });

    return result;
  }

  /**
   * Delete a volume and remove its DB record.
   * Always cleans up the DB record even if the provider fails (e.g. volume
   * only existed as a plain Docker volume with no backing storage).
   */
  async deleteVolume(accountId: string, name: string): Promise<void> {
    // Look up the volume to find its cluster
    const dbVolume = await db.query.storageVolumes.findFirst({
      where: and(
        eq(storageVolumes.name, name),
        eq(storageVolumes.accountId, accountId),
        isNull(storageVolumes.deletedAt),
      ),
    });

    const cluster = dbVolume?.clusterId
      ? this.clusters.get(dbVolume.clusterId)
      : undefined;
    const provider = cluster?.volumeProvider ?? this.getDefaultCluster().volumeProvider;

    try {
      await provider.deleteVolume(name);
    } catch (err) {
      // Provider may fail if the volume doesn't physically exist (e.g. orphaned DB record
      // from a template deployed without NFS). Still clean up the DB record.
      logger.warn({ err, name }, 'Volume provider delete failed — cleaning up DB record anyway');
    }

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
      const cluster = v.clusterId
        ? this.clusters.get(v.clusterId)
        : undefined;
      const provider = cluster?.volumeProvider ?? this.getDefaultCluster().volumeProvider;

      const region = cluster?.region ?? null;
      try {
        const live = await provider.getVolumeInfo(v.name);
        // Use the DB-tracked sizeGb as the authoritative allocation size.
        // Provider's sizeGb comes from `df` which reports the entire
        // filesystem (NFS/GlusterFS), not the per-volume allocation.
        const allocatedGb = v.sizeGb || live.sizeGb;
        results.push({
          ...live,
          sizeGb: allocatedGb,
          availableGb: Math.max(0, allocatedGb - live.usedGb),
          replicaCount: v.replicaCount ?? 1,
          status: v.status,
          region,
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
          region,
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
    const entry = this.defaultClusterId ? this.clusters.get(this.defaultClusterId) : undefined;
    if (!this.initialized || !entry) {
      return {
        volumes: { status: 'error', provider: 'unknown', message: 'Storage manager not initialized' },
        objects: { status: 'error', provider: 'unknown', message: 'Storage manager not initialized' },
      };
    }
    const [volumeHealth, objectHealth] = await Promise.all([
      entry.volumeProvider.getHealth(),
      entry.objectProvider.getHealth(),
    ]);
    return { volumes: volumeHealth, objects: objectHealth };
  }

  /** Get health for a specific cluster. */
  async getClusterHealth(clusterId: string): Promise<{ volumes: StorageHealth; objects: StorageHealth } | null> {
    const entry = this.clusters.get(clusterId);
    if (!entry) return null;

    const [volumeHealth, objectHealth] = await Promise.all([
      entry.volumeProvider.getHealth(),
      entry.objectProvider.getHealth(),
    ]);
    return { volumes: volumeHealth, objects: objectHealth };
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private getDefaultCluster(): ClusterEntry {
    const entry = this.defaultClusterId ? this.clusters.get(this.defaultClusterId) : undefined;
    if (!entry) throw new Error('No default storage cluster available');
    return entry;
  }

  private async loadProviders(clusterConfig: StorageClusterConfig): Promise<{
    volumeProvider: VolumeStorageProvider;
    objectProvider: ObjectStorageProvider;
  }> {
    const volumeType = clusterConfig.provider ?? 'local';
    const objectType = clusterConfig.objectProvider ?? 'local';

    // Volume provider
    let volumeProvider: VolumeStorageProvider;
    switch (volumeType) {
      case 'glusterfs': {
        const { GlusterFSVolumeProvider } = await import('./providers/glusterfs-volume.provider.js');
        volumeProvider = new GlusterFSVolumeProvider(clusterConfig.config);
        break;
      }
      case 'ceph': {
        const { CephVolumeProvider } = await import('./providers/ceph-volume.provider.js');
        volumeProvider = new CephVolumeProvider(clusterConfig.config);
        break;
      }
      case 'local':
      default:
        volumeProvider = new LocalVolumeProvider();
        break;
    }

    // Object provider
    let objectProvider: ObjectStorageProvider;
    switch (objectType) {
      case 'minio': {
        const { MinIOObjectProvider } = await import('./providers/minio-object.provider.js');
        objectProvider = new MinIOObjectProvider(clusterConfig.objectConfig);
        break;
      }
      case 's3': {
        const { S3ObjectProvider } = await import('./providers/s3-object.provider.js');
        objectProvider = new S3ObjectProvider(clusterConfig.objectConfig);
        break;
      }
      case 'gcs': {
        const { GCSObjectProvider } = await import('./providers/gcs-object.provider.js');
        objectProvider = new GCSObjectProvider(clusterConfig.objectConfig);
        break;
      }
      case 'local':
      default:
        objectProvider = new LocalObjectProvider();
        break;
    }

    // Initialize providers
    await volumeProvider.initialize();
    await objectProvider.initialize();

    // Ensure default buckets exist
    for (const bucket of Object.values(STORAGE_BUCKETS)) {
      await objectProvider.ensureBucket(bucket).catch((err) => {
        logger.warn({ err, bucket }, 'Failed to ensure bucket');
      });
    }

    return { volumeProvider, objectProvider };
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
