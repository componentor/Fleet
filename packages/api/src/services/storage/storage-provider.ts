/**
 * Storage Provider Interfaces
 *
 * Two categories of storage:
 * - Volume storage (POSIX): mounted into Docker containers (GlusterFS, local NFS)
 * - Object storage (S3-like): uploads, backups, build artifacts (MinIO, local filesystem)
 */

// ── Volume Storage ──────────────────────────────────────────────────────────

export interface VolumeInfo {
  name: string;
  displayName?: string;
  path: string;
  sizeGb: number;
  usedGb: number;
  availableGb: number;
  replicaCount?: number;
  status?: string;
  nodeId?: string;
  region?: string | null;
}

export interface VolumeResult {
  name: string;
  path: string;
  driver: string;
  driverOptions: Record<string, string>;
}

/** Host prerequisites needed by a storage provider. */
export interface StoragePrerequisite {
  /** apt/yum package name to install on each Swarm node */
  package: string;
  /** Human-readable description */
  description: string;
  /** Command to check if already installed (exit 0 = installed) */
  checkCommand: string;
  /** apt install command */
  installCommand: string;
}

export interface VolumeStorageProvider {
  readonly name: string;

  /** One-time initialization (connect, verify prerequisites). */
  initialize(): Promise<void>;

  // Volume lifecycle
  createVolume(name: string, sizeGb: number, nodeId?: string): Promise<VolumeResult>;
  deleteVolume(name: string): Promise<void>;
  resizeVolume(name: string, newSizeGb: number): Promise<void>;
  listVolumes(): Promise<VolumeInfo[]>;
  getVolumeInfo(name: string): Promise<VolumeInfo>;

  /** Docker volume driver name (e.g. 'local', 'glusterfs'). */
  getDockerVolumeDriver(): string;

  /** Driver-specific options for mounting a volume in Docker. */
  getDockerVolumeOptions(name: string): Record<string, string>;

  /**
   * If the provider uses host-level FUSE mounts (e.g. GlusterFS), returns the
   * host path where volumes are mounted. Docker uses a bind mount to this path
   * instead of a volume driver (which can't do FUSE mounts).
   * Returns null for providers that work natively with Docker's volume driver.
   */
  getHostMountPath?(name: string): string | null;

  /**
   * Ensure a volume's host path exists and is accessible.
   * Called before Docker service create/update to prevent bind mount failures.
   * Providers that don't use host-level mounts can omit this.
   */
  ensureVolume?(name: string): Promise<void>;

  /**
   * Whether the storage cluster is operational and can serve volumes.
   * When false, docker.service.ts will fall back to plain local volumes.
   */
  isReady(): boolean;

  /** Host packages/tools required on each Swarm node for volumes to mount. */
  getPrerequisites(): StoragePrerequisite[];

  /** Provider health status. */
  getHealth(): Promise<StorageHealth>;
}

// ── Object Storage ──────────────────────────────────────────────────────────

export interface ObjectInfo {
  key: string;
  size: number;
  lastModified: Date;
  etag?: string;
}

export interface ObjectStorageProvider {
  readonly name: string;

  /** One-time initialization (connect, verify prerequisites). */
  initialize(): Promise<void>;

  /** Store an object. */
  putObject(bucket: string, key: string, data: Buffer | NodeJS.ReadableStream, size?: number): Promise<void>;

  /** Retrieve an object as a readable stream. */
  getObject(bucket: string, key: string): Promise<NodeJS.ReadableStream>;

  /** Retrieve an object as a buffer (convenience). */
  getObjectBuffer(bucket: string, key: string): Promise<Buffer>;

  /** Delete a single object. */
  deleteObject(bucket: string, key: string): Promise<void>;

  /** Delete all objects under a prefix. Returns count of deleted objects. */
  deletePrefix(bucket: string, prefix: string): Promise<number>;

  /** List objects under a prefix. */
  listObjects(bucket: string, prefix?: string): Promise<ObjectInfo[]>;

  /** Check if an object exists. */
  objectExists(bucket: string, key: string): Promise<boolean>;

  /** Ensure a bucket exists, creating it if necessary. */
  ensureBucket(bucket: string): Promise<void>;

  /** Provider health status. */
  getHealth(): Promise<StorageHealth>;
}

// ── Health ───────────────────────────────────────────────────────────────────

export type StorageHealthStatus = 'healthy' | 'degraded' | 'error' | 'unavailable';

export interface StorageNodeHealth {
  hostname: string;
  ipAddress: string;
  status: StorageHealthStatus;
  capacityGb?: number;
  usedGb?: number;
  message?: string;
}

export interface StorageHealth {
  status: StorageHealthStatus;
  provider: string;
  message?: string;
  nodes?: StorageNodeHealth[];
  replicationFactor?: number;
  activeReplicas?: number;
}

// ── Standard Buckets ────────────────────────────────────────────────────────

export const STORAGE_BUCKETS = {
  UPLOADS: 'fleet-uploads',
  BACKUPS: 'fleet-backups',
  BUILDS: 'fleet-builds',
} as const;
