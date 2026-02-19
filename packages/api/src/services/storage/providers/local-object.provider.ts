import { mkdir, readFile, writeFile, rm, readdir, stat, access } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type {
  ObjectStorageProvider,
  ObjectInfo,
  StorageHealth,
} from '../storage-provider.js';

const NODE_ENV = process.env['NODE_ENV'] ?? 'development';
const OBJECT_BASE_PATH = process.env['OBJECT_STORAGE_PATH']
  ?? (NODE_ENV === 'production' ? '/srv/fleet-objects' : `${process.cwd()}/data/objects`);

/** Validate a bucket name — alphanumeric, hyphens, dots only. */
function validateBucketName(bucket: string): void {
  if (!bucket || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(bucket) || bucket.includes('..')) {
    throw new Error(`Invalid bucket name: ${bucket}`);
  }
}

/** Resolve and validate a path to prevent traversal. */
function safePath(bucket: string, key: string): string {
  validateBucketName(bucket);
  if (key.includes('\0')) throw new Error('Invalid key: contains null byte');
  const resolved = join(OBJECT_BASE_PATH, bucket, key);
  const base = join(OBJECT_BASE_PATH, bucket);
  if (!resolved.startsWith(base + '/') && resolved !== base) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

function bucketPath(bucket: string): string {
  validateBucketName(bucket);
  return join(OBJECT_BASE_PATH, bucket);
}

/**
 * Local object provider — stores objects as files on the local filesystem.
 * Buckets = directories. Keys = file paths within the bucket directory.
 * Default provider for dev and single-node setups.
 */
export class LocalObjectProvider implements ObjectStorageProvider {
  readonly name = 'local';

  async initialize(): Promise<void> {
    await mkdir(OBJECT_BASE_PATH, { recursive: true });
  }

  async putObject(
    bucket: string,
    key: string,
    data: Buffer | NodeJS.ReadableStream,
    _size?: number,
  ): Promise<void> {
    const filePath = safePath(bucket, key);
    await mkdir(dirname(filePath), { recursive: true });

    if (Buffer.isBuffer(data)) {
      await writeFile(filePath, data);
    } else {
      const writable = createWriteStream(filePath);
      await pipeline(data as Readable, writable);
    }
  }

  async getObject(bucket: string, key: string): Promise<NodeJS.ReadableStream> {
    const filePath = safePath(bucket, key);
    return createReadStream(filePath);
  }

  async getObjectBuffer(bucket: string, key: string): Promise<Buffer> {
    const filePath = safePath(bucket, key);
    return readFile(filePath);
  }

  async deleteObject(bucket: string, key: string): Promise<void> {
    const filePath = safePath(bucket, key);
    await rm(filePath, { force: true });
  }

  async deletePrefix(bucket: string, prefix: string): Promise<number> {
    const dirPath = safePath(bucket, prefix);
    let count = 0;

    try {
      const s = await stat(dirPath);
      if (s.isDirectory()) {
        count = await this.countFiles(dirPath);
        await rm(dirPath, { recursive: true, force: true });
      } else {
        await rm(dirPath, { force: true });
        count = 1;
      }
    } catch {
      // Path doesn't exist
    }

    return count;
  }

  async listObjects(bucket: string, prefix?: string): Promise<ObjectInfo[]> {
    const dirPath = prefix ? safePath(bucket, prefix) : bucketPath(bucket);
    const results: ObjectInfo[] = [];

    try {
      await this.walkDir(dirPath, bucketPath(bucket), results);
    } catch {
      // Directory doesn't exist
    }

    return results;
  }

  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      const filePath = safePath(bucket, key);
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async ensureBucket(bucket: string): Promise<void> {
    await mkdir(bucketPath(bucket), { recursive: true });
  }

  async getHealth(): Promise<StorageHealth> {
    try {
      await access(OBJECT_BASE_PATH);
      return { status: 'healthy', provider: 'local', message: 'Local object storage accessible' };
    } catch {
      return { status: 'error', provider: 'local', message: 'Object storage path not accessible' };
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private async walkDir(dir: string, basePath: string, results: ObjectInfo[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.walkDir(fullPath, basePath, results);
      } else if (entry.isFile()) {
        const s = await stat(fullPath);
        const key = fullPath.slice(basePath.length + 1); // relative to bucket
        results.push({
          key,
          size: s.size,
          lastModified: s.mtime,
        });
      }
    }
  }

  private async countFiles(dir: string): Promise<number> {
    let count = 0;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        count += await this.countFiles(join(dir, entry.name));
      } else {
        count++;
      }
    }
    return count;
  }
}
