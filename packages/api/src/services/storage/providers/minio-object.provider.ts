import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CreateBucketCommand,
  HeadBucketCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { logger } from '../../logger.js';
import type {
  ObjectStorageProvider,
  ObjectInfo,
  StorageHealth,
} from '../storage-provider.js';

export interface MinIOConfig {
  endpoint: string;          // e.g. "http://10.0.1.10:9000"
  accessKey: string;
  secretKey: string;
  region?: string;           // default "us-east-1"
  forcePathStyle?: boolean;  // default true for MinIO
}

/**
 * MinIO Object Provider — S3-compatible object storage via @aws-sdk/client-s3.
 * Works with MinIO in distributed mode or any S3-compatible endpoint.
 */
export class MinIOObjectProvider implements ObjectStorageProvider {
  readonly name = 'minio';
  private client: S3Client;
  private config: MinIOConfig;

  constructor(config: Record<string, any>) {
    this.config = {
      endpoint: config.endpoint ?? 'http://localhost:9000',
      accessKey: config.accessKey ?? '',
      secretKey: config.secretKey ?? '',
      region: config.region ?? 'us-east-1',
      forcePathStyle: config.forcePathStyle ?? true,
    };

    this.client = new S3Client({
      endpoint: this.config.endpoint,
      region: this.config.region,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: this.config.accessKey,
        secretAccessKey: this.config.secretKey,
      },
    });
  }

  async initialize(): Promise<void> {
    // If no credentials are set, MinIO is pending auto-configuration — skip connectivity check
    if (!this.config.accessKey && !this.config.secretKey) {
      logger.info({ endpoint: this.config.endpoint }, 'MinIO pending auto-configuration — skipping connectivity check');
      return;
    }

    // Verify connectivity by listing buckets
    try {
      const { ListBucketsCommand } = await import('@aws-sdk/client-s3');
      await this.client.send(new ListBucketsCommand({}));
      logger.info({ endpoint: this.config.endpoint }, 'MinIO connection verified');
    } catch (err) {
      throw new Error(`Failed to connect to MinIO at ${this.config.endpoint}: ${err}`);
    }
  }

  async putObject(
    bucket: string,
    key: string,
    data: Buffer | NodeJS.ReadableStream,
    size?: number,
  ): Promise<void> {
    const body = Buffer.isBuffer(data)
      ? data
      : Readable.from(data as AsyncIterable<Buffer>);

    await this.client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentLength: size ?? (Buffer.isBuffer(data) ? data.length : undefined),
    }));
  }

  async getObject(bucket: string, key: string): Promise<NodeJS.ReadableStream> {
    const result = await this.client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));

    if (!result.Body) {
      throw new Error(`Object not found: ${bucket}/${key}`);
    }

    return result.Body as NodeJS.ReadableStream;
  }

  async getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
    const stream = await this.getObject(bucket, key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }));
  }

  async deletePrefix(bucket: string, prefix: string): Promise<number> {
    let deleted = 0;
    let continuationToken: string | undefined;

    do {
      const listResult = await this.client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));

      const objects = listResult.Contents;
      if (!objects || objects.length === 0) break;

      // Delete in batches of up to 1000
      await this.client.send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: objects.map((o: any) => ({ Key: o.Key! })),
          Quiet: true,
        },
      }));

      deleted += objects.length;
      continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
    } while (continuationToken);

    return deleted;
  }

  async listObjects(bucket: string, prefix?: string): Promise<ObjectInfo[]> {
    const results: ObjectInfo[] = [];
    let continuationToken: string | undefined;

    do {
      const listResult = await this.client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));

      if (listResult.Contents) {
        for (const obj of listResult.Contents) {
          results.push({
            key: obj.Key!,
            size: obj.Size ?? 0,
            lastModified: obj.LastModified ?? new Date(),
            etag: obj.ETag,
          });
        }
      }

      continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
    } while (continuationToken);

    return results;
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      }));
      return true;
    } catch {
      return false;
    }
  }

  async ensureBucket(bucket: string): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: bucket }));
        logger.info({ bucket }, 'MinIO bucket created');
      } catch (err) {
        // Bucket might have been created by another node concurrently
        logger.debug({ err, bucket }, 'Bucket creation skipped');
      }
    }
  }

  async getHealth(): Promise<StorageHealth> {
    // If no credentials, MinIO is pending auto-configuration
    if (!this.config.accessKey && !this.config.secretKey) {
      return {
        status: 'healthy',
        provider: 'minio',
        message: 'MinIO pending auto-configuration — will be deployed during storage initialization',
      };
    }

    try {
      const { ListBucketsCommand } = await import('@aws-sdk/client-s3');
      await this.client.send(new ListBucketsCommand({}));
      return {
        status: 'healthy',
        provider: 'minio',
        message: `Connected to ${this.config.endpoint}`,
      };
    } catch (err) {
      return {
        status: 'error',
        provider: 'minio',
        message: `Cannot reach MinIO at ${this.config.endpoint}: ${err}`,
      };
    }
  }
}
