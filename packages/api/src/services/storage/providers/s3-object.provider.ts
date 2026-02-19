import type {
  ObjectStorageProvider,
  ObjectInfo,
  StorageHealth,
} from '../storage-provider.js';

/**
 * AWS S3 Object Storage Provider.
 *
 * Uses @aws-sdk/client-s3 for native S3 operations.
 * Also works with any S3-compatible service (Backblaze B2, Wasabi, etc.)
 * by setting a custom endpoint.
 *
 * Config:
 *   region      — AWS region (default: 'us-east-1')
 *   accessKeyId — AWS access key ID
 *   secretAccessKey — AWS secret access key
 *   endpoint    — Custom S3 endpoint (for S3-compatible services)
 *   bucketPrefix — Prefix for all bucket names (default: '')
 *   forcePathStyle — Use path-style URLs (required for some S3-compatible services)
 */
export class S3ObjectProvider implements ObjectStorageProvider {
  readonly name = 's3';

  private region: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private endpoint: string | undefined;
  private bucketPrefix: string;
  private forcePathStyle: boolean;
  private client: any; // S3Client — lazy loaded

  constructor(config: Record<string, any>) {
    this.region = config.region ?? 'us-east-1';
    this.accessKeyId = config.accessKeyId ?? '';
    this.secretAccessKey = config.secretAccessKey ?? '';
    this.endpoint = config.endpoint ?? undefined;
    this.bucketPrefix = config.bucketPrefix ?? '';
    this.forcePathStyle = config.forcePathStyle ?? !!config.endpoint;
  }

  async initialize(): Promise<void> {
    const { S3Client } = await import('@aws-sdk/client-s3');

    this.client = new S3Client({
      region: this.region,
      credentials: {
        accessKeyId: this.accessKeyId,
        secretAccessKey: this.secretAccessKey,
      },
      ...(this.endpoint ? { endpoint: this.endpoint } : {}),
      forcePathStyle: this.forcePathStyle,
    });

    // Verify connectivity
    const { ListBucketsCommand } = await import('@aws-sdk/client-s3');
    await this.client.send(new ListBucketsCommand({}));
  }

  private prefixBucket(bucket: string): string {
    return this.bucketPrefix ? `${this.bucketPrefix}-${bucket}` : bucket;
  }

  async putObject(
    bucket: string,
    key: string,
    data: Buffer | NodeJS.ReadableStream,
    size?: number,
  ): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');

    const params: any = {
      Bucket: this.prefixBucket(bucket),
      Key: key,
      Body: data,
    };

    if (size !== undefined) {
      params.ContentLength = size;
    }

    await this.client.send(new PutObjectCommand(params));
  }

  async getObject(bucket: string, key: string): Promise<NodeJS.ReadableStream> {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');

    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.prefixBucket(bucket),
        Key: key,
      }),
    );

    return response.Body as NodeJS.ReadableStream;
  }

  async getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
    const stream = await this.getObject(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as any));
    }
    return Buffer.concat(chunks);
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');

    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.prefixBucket(bucket),
        Key: key,
      }),
    );
  }

  async deletePrefix(bucket: string, prefix: string): Promise<number> {
    const objects = await this.listObjects(bucket, prefix);
    if (objects.length === 0) return 0;

    const { DeleteObjectsCommand } = await import('@aws-sdk/client-s3');

    // S3 DeleteObjects supports max 1000 keys per request
    let deleted = 0;
    const batchSize = 1000;

    for (let i = 0; i < objects.length; i += batchSize) {
      const batch = objects.slice(i, i + batchSize);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.prefixBucket(bucket),
          Delete: {
            Objects: batch.map((o) => ({ Key: o.key })),
            Quiet: true,
          },
        }),
      );
      deleted += batch.length;
    }

    return deleted;
  }

  async listObjects(bucket: string, prefix?: string): Promise<ObjectInfo[]> {
    const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');

    const results: ObjectInfo[] = [];
    let continuationToken: string | undefined;

    do {
      const response: any = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.prefixBucket(bucket),
          Prefix: prefix,
          ContinuationToken: continuationToken,
          MaxKeys: 1000,
        }),
      );

      for (const obj of response.Contents ?? []) {
        results.push({
          key: obj.Key!,
          size: obj.Size ?? 0,
          lastModified: obj.LastModified ?? new Date(),
          etag: obj.ETag,
        });
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return results;
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');

    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.prefixBucket(bucket),
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async ensureBucket(bucket: string): Promise<void> {
    const { HeadBucketCommand, CreateBucketCommand } = await import('@aws-sdk/client-s3');
    const prefixed = this.prefixBucket(bucket);

    try {
      await this.client.send(new HeadBucketCommand({ Bucket: prefixed }));
    } catch {
      await this.client.send(
        new CreateBucketCommand({
          Bucket: prefixed,
          ...(this.region !== 'us-east-1'
            ? { CreateBucketConfiguration: { LocationConstraint: this.region } }
            : {}),
        }),
      );
    }
  }

  async getHealth(): Promise<StorageHealth> {
    try {
      const { ListBucketsCommand } = await import('@aws-sdk/client-s3');
      const response = await this.client.send(new ListBucketsCommand({}));
      const bucketCount = response.Buckets?.length ?? 0;

      return {
        status: 'healthy',
        provider: 's3',
        message: `S3 connected (${this.endpoint ?? `${this.region}.amazonaws.com`}), ${bucketCount} bucket(s)`,
      };
    } catch (err) {
      return {
        status: 'error',
        provider: 's3',
        message: `S3 connection failed: ${err}`,
      };
    }
  }
}
