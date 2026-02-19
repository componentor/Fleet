import type {
  ObjectStorageProvider,
  ObjectInfo,
  StorageHealth,
} from '../storage-provider.js';

/**
 * Google Cloud Storage (GCS) Object Provider.
 *
 * Uses the @google-cloud/storage SDK for native GCS operations.
 * Supports both service account authentication and workload identity.
 *
 * Config:
 *   projectId       — GCP project ID
 *   keyFilename     — Path to service account JSON key file (optional if using workload identity)
 *   credentials     — Inline service account credentials object (alternative to keyFilename)
 *   bucketPrefix    — Prefix for all bucket names (default: '')
 *   location        — Default storage location for new buckets (default: 'US')
 *   storageClass    — Default storage class: STANDARD, NEARLINE, COLDLINE, ARCHIVE (default: 'STANDARD')
 */
export class GCSObjectProvider implements ObjectStorageProvider {
  readonly name = 'gcs';

  private projectId: string;
  private keyFilename: string | undefined;
  private credentials: Record<string, any> | undefined;
  private bucketPrefix: string;
  private location: string;
  private storageClass: string;
  private storage: any; // Storage — lazy loaded

  constructor(config: Record<string, any>) {
    this.projectId = config.projectId ?? '';
    this.keyFilename = config.keyFilename ?? undefined;
    this.credentials = config.credentials ?? undefined;
    this.bucketPrefix = config.bucketPrefix ?? '';
    this.location = config.location ?? 'US';
    this.storageClass = config.storageClass ?? 'STANDARD';
  }

  async initialize(): Promise<void> {
    const { Storage } = await import('@google-cloud/storage');

    const opts: Record<string, any> = {};
    if (this.projectId) opts.projectId = this.projectId;
    if (this.keyFilename) opts.keyFilename = this.keyFilename;
    if (this.credentials) opts.credentials = this.credentials;

    this.storage = new Storage(opts);

    // Verify connectivity by listing buckets (limited to 1)
    await this.storage.getBuckets({ maxResults: 1 });
  }

  private prefixBucket(bucket: string): string {
    return this.bucketPrefix ? `${this.bucketPrefix}-${bucket}` : bucket;
  }

  async putObject(
    bucket: string,
    key: string,
    data: Buffer | NodeJS.ReadableStream,
    _size?: number,
  ): Promise<void> {
    const gcsBucket = this.storage.bucket(this.prefixBucket(bucket));
    const file = gcsBucket.file(key);

    if (Buffer.isBuffer(data)) {
      await file.save(data);
    } else {
      const { pipeline } = await import('node:stream/promises');
      const writable = file.createWriteStream({
        resumable: false,
        metadata: { contentType: 'application/octet-stream' },
      });
      await pipeline(data as any, writable);
    }
  }

  async getObject(bucket: string, key: string): Promise<NodeJS.ReadableStream> {
    const gcsBucket = this.storage.bucket(this.prefixBucket(bucket));
    const file = gcsBucket.file(key);
    // createReadStream() returns a ReadableStream directly (not an array)
    return file.createReadStream();
  }

  async getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
    const gcsBucket = this.storage.bucket(this.prefixBucket(bucket));
    const file = gcsBucket.file(key);
    const [contents] = await file.download();
    return contents;
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    const gcsBucket = this.storage.bucket(this.prefixBucket(bucket));
    await gcsBucket.file(key).delete({ ignoreNotFound: true });
  }

  async deletePrefix(bucket: string, prefix: string): Promise<number> {
    const gcsBucket = this.storage.bucket(this.prefixBucket(bucket));
    const [files] = await gcsBucket.getFiles({ prefix });

    if (files.length === 0) return 0;

    // GCS supports batch deletion
    await Promise.all(files.map((f: any) => f.delete({ ignoreNotFound: true })));
    return files.length;
  }

  async listObjects(bucket: string, prefix?: string): Promise<ObjectInfo[]> {
    const gcsBucket = this.storage.bucket(this.prefixBucket(bucket));
    const [files] = await gcsBucket.getFiles(prefix ? { prefix } : {});

    return files.map((f: any) => ({
      key: f.name,
      size: parseInt(f.metadata?.size ?? '0', 10),
      lastModified: new Date(f.metadata?.updated ?? f.metadata?.timeCreated ?? Date.now()),
      etag: f.metadata?.etag,
    }));
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    const gcsBucket = this.storage.bucket(this.prefixBucket(bucket));
    const [exists] = await gcsBucket.file(key).exists();
    return exists;
  }

  async ensureBucket(bucket: string): Promise<void> {
    const prefixed = this.prefixBucket(bucket);
    const gcsBucket = this.storage.bucket(prefixed);

    const [exists] = await gcsBucket.exists();
    if (!exists) {
      await this.storage.createBucket(prefixed, {
        location: this.location,
        storageClass: this.storageClass,
      });
    }
  }

  async getHealth(): Promise<StorageHealth> {
    try {
      const [buckets] = await this.storage.getBuckets({ maxResults: 100 });
      return {
        status: 'healthy',
        provider: 'gcs',
        message: `GCS connected (project: ${this.projectId || 'default'}), ${buckets.length} bucket(s)`,
      };
    } catch (err) {
      return {
        status: 'error',
        provider: 'gcs',
        message: `GCS connection failed: ${err}`,
      };
    }
  }
}
