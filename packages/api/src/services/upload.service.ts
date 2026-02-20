import { mkdir, readdir, readFile, writeFile, rm, stat, lstat, copyFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

const execFile = promisify(execFileCb);

const UPLOAD_BASE = process.env['UPLOAD_BASE_PATH']
  ?? (process.env['NODE_ENV'] === 'production' ? '/srv/nfs/uploads' : join(process.cwd(), 'data', 'uploads'));
const MAX_EXTRACTED_SIZE = 1024 * 1024 * 1024; // 1 GB
const MAX_FILE_READ_SIZE = 10 * 1024 * 1024; // 10 MB

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

export class UploadService {
  /**
   * Resolve a path safely within a base directory.
   * Prevents path traversal attacks.
   */
  private resolveSafePath(basePath: string, relativePath: string): string {
    // Normalize and strip leading slashes
    const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (cleaned.includes('..')) {
      throw new Error('Path traversal detected');
    }
    const resolved = resolve(basePath, cleaned);
    if (!resolved.startsWith(basePath + '/') && resolved !== basePath) {
      throw new Error('Path traversal detected');
    }
    return resolved;
  }

  /**
   * Get the storage path for a service's uploaded files.
   */
  getServicePath(accountId: string, serviceId: string): string {
    return join(UPLOAD_BASE, accountId, serviceId);
  }

  /**
   * Extract an archive and store to NFS.
   */
  async extractAndStore(opts: {
    accountId: string;
    serviceId: string;
    archivePath: string;
    archiveType: 'zip' | 'tar' | 'tar.gz';
  }): Promise<string> {
    const destPath = this.getServicePath(opts.accountId, opts.serviceId);
    await mkdir(destPath, { recursive: true });

    // Pre-check: validate archive size before extraction to mitigate zip bombs.
    // For zip files, check reported uncompressed size first.
    if (opts.archiveType === 'zip') {
      try {
        const { stdout } = await execFile('unzip', ['-l', opts.archivePath], {
          timeout: 30_000,
          maxBuffer: 10 * 1024 * 1024,
        });
        // Last line of unzip -l contains total size, e.g. "  12345678  42 files"
        const totalMatch = stdout.match(/^\s*(\d+)\s+\d+\s+files?/m);
        if (totalMatch) {
          const reportedSize = parseInt(totalMatch[1]!, 10);
          if (reportedSize > MAX_EXTRACTED_SIZE) {
            throw new Error(`Archive reported size (${Math.round(reportedSize / 1024 / 1024)} MB) exceeds maximum (${Math.round(MAX_EXTRACTED_SIZE / 1024 / 1024)} MB)`);
          }
        }

        // Also check number of entries to prevent zip bomb with many small files
        const MAX_ENTRIES = 50_000;
        const entryMatch = stdout.match(/(\d+)\s+files?/);
        if (entryMatch && parseInt(entryMatch[1]!, 10) > MAX_ENTRIES) {
          throw new Error(`Archive contains too many entries (max ${MAX_ENTRIES})`);
        }
      } catch (err) {
        if ((err as Error).message.includes('exceeds maximum') || (err as Error).message.includes('too many entries')) {
          throw err;
        }
        // If unzip -l fails, proceed with caution but still extract with size monitoring
      }
    }

    if (opts.archiveType === 'zip') {
      await execFile('unzip', ['-o', '-q', opts.archivePath, '-d', destPath], {
        timeout: 120_000,
        maxBuffer: 50 * 1024 * 1024,
      });
    } else if (opts.archiveType === 'tar') {
      await execFile('tar', ['-xf', opts.archivePath, '-C', destPath], {
        timeout: 120_000,
        maxBuffer: 50 * 1024 * 1024,
      });
    } else {
      // tar.gz
      await execFile('tar', ['-xzf', opts.archivePath, '-C', destPath], {
        timeout: 120_000,
        maxBuffer: 50 * 1024 * 1024,
      });
    }

    // Security: validate all extracted paths are within the destination (zip-slip protection)
    await this.validateExtractedPaths(destPath);

    // Security: remove symlinks that point outside the dest BEFORE size check
    await this.removeUnsafeSymlinks(destPath);

    // Check total extracted size
    const totalSize = await this.getDirectorySize(destPath);
    if (totalSize > MAX_EXTRACTED_SIZE) {
      await rm(destPath, { recursive: true, force: true });
      throw new Error(`Extracted content exceeds maximum size (${Math.round(MAX_EXTRACTED_SIZE / 1024 / 1024)} MB)`);
    }

    // If the archive extracted into a single subdirectory, hoist its contents up
    const entries = await readdir(destPath);
    if (entries.length === 1) {
      const singleEntry = join(destPath, entries[0]!);
      const st = await stat(singleEntry);
      if (st.isDirectory()) {
        const innerEntries = await readdir(singleEntry);
        for (const e of innerEntries) {
          await execFile('mv', [join(singleEntry, e), destPath]);
        }
        await rm(singleEntry, { recursive: true, force: true });
      }
    }

    return destPath;
  }

  /**
   * Store multiple files (from folder upload).
   */
  async storeMultipleFiles(opts: {
    accountId: string;
    serviceId: string;
    files: Array<{ relativePath: string; tempPath: string }>;
  }): Promise<string> {
    const destPath = this.getServicePath(opts.accountId, opts.serviceId);

    for (const file of opts.files) {
      const targetPath = this.resolveSafePath(destPath, file.relativePath);
      const dir = join(targetPath, '..');
      await mkdir(dir, { recursive: true });
      await copyFile(file.tempPath, targetPath);
    }

    return destPath;
  }

  /**
   * Detect project files and determine build method.
   * Never fails — uploads are always accepted.
   */
  async detectProjectFiles(sourcePath: string, buildFile?: string): Promise<{
    detectedFiles: string[];
    buildMethod: 'dockerfile' | 'compose' | 'none';
    buildFile: string | null;
    detectedRuntime: string | null;
    generatedDockerfile: string | null;
    defaultPort: number | null;
  }> {
    const detectedFiles: string[] = [];
    let buildMethod: 'dockerfile' | 'compose' | 'none' = 'none';
    let resolvedBuildFile: string | null = null;
    let detectedRuntime: string | null = null;
    let generatedDockerfile: string | null = null;
    let defaultPort: number | null = null;

    try {
      const entries = await readdir(sourcePath);

      // Check for explicit build file if specified
      if (buildFile) {
        const buildFilePath = this.resolveSafePath(sourcePath, buildFile);
        try {
          await stat(buildFilePath);
          detectedFiles.push(buildFile);
          const lower = buildFile.toLowerCase();
          if (lower.includes('compose')) {
            buildMethod = 'compose';
          } else {
            buildMethod = 'dockerfile';
          }
          resolvedBuildFile = buildFile;
        } catch {
          // Specified build file doesn't exist — that's fine, try auto-detect
        }
      }

      // Auto-detect build files if none specified or specified one not found
      if (buildMethod === 'none') {
        // Check for Dockerfile first
        try {
          await stat(this.resolveSafePath(sourcePath, 'Dockerfile'));
          detectedFiles.push('Dockerfile');
          buildMethod = 'dockerfile';
          resolvedBuildFile = 'Dockerfile';
        } catch {
          // No Dockerfile
        }
      }

      if (buildMethod === 'none') {
        // Check for compose files
        const composeNames = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
        for (const name of composeNames) {
          if (entries.includes(name)) {
            detectedFiles.push(name);
            if (buildMethod === 'none') {
              buildMethod = 'compose';
              resolvedBuildFile = name;
            }
          }
        }
      }

      // Detect other useful files
      for (const entry of entries) {
        if (entry === '.dockerignore') detectedFiles.push(entry);
        if (entry === 'package.json') detectedFiles.push(entry);
        if (entry === 'requirements.txt') detectedFiles.push(entry);
        if (entry === 'go.mod') detectedFiles.push(entry);
        if (entry === 'Cargo.toml') detectedFiles.push(entry);
      }

      // Auto-detect runtime and generate Dockerfile when no build file found
      if (buildMethod === 'none') {
        const { detectRuntime } = await import('./runtime.service.js');
        const fileReader = async (name: string): Promise<string | null> => {
          try {
            const filePath = this.resolveSafePath(sourcePath, name);
            const content = await readFile(filePath, 'utf-8');
            return content;
          } catch {
            return null;
          }
        };
        const detection = await detectRuntime(entries, fileReader);
        if (detection) {
          // Write generated Dockerfile to source directory
          await writeFile(join(sourcePath, 'Dockerfile'), detection.dockerfile, 'utf-8');
          buildMethod = 'dockerfile';
          resolvedBuildFile = 'Dockerfile';
          detectedRuntime = detection.runtime;
          generatedDockerfile = detection.dockerfile;
          defaultPort = detection.port;
          detectedFiles.push('Dockerfile');
        }
      }
    } catch {
      // Directory read failed — that's OK, we still accept the upload
    }

    return {
      detectedFiles: [...new Set(detectedFiles)],
      buildMethod,
      buildFile: resolvedBuildFile,
      detectedRuntime,
      generatedDockerfile,
      defaultPort,
    };
  }

  /**
   * List directory contents.
   */
  async listDirectory(sourcePath: string, relativePath: string = '/'): Promise<FileEntry[]> {
    const dirPath = relativePath === '/' ? sourcePath : this.resolveSafePath(sourcePath, relativePath);
    const entries = await readdir(dirPath);
    const results: FileEntry[] = [];

    for (const name of entries) {
      // Skip hidden files starting with .git
      if (name === '.git') continue;

      const fullPath = join(dirPath, name);
      try {
        const st = await lstat(fullPath);
        if (st.isSymbolicLink()) continue; // Skip symlinks

        results.push({
          name,
          type: st.isDirectory() ? 'directory' : 'file',
          size: st.isDirectory() ? 0 : st.size,
          modified: st.mtime.toISOString(),
        });
      } catch {
        // Skip entries we can't stat
      }
    }

    // Sort: directories first, then files, alphabetically
    results.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return results;
  }

  /**
   * Read a file's content.
   */
  async readFile(sourcePath: string, relativePath: string): Promise<{
    content: string;
    size: number;
    modified: string;
  }> {
    const filePath = this.resolveSafePath(sourcePath, relativePath);
    const st = await stat(filePath);

    if (st.isDirectory()) {
      throw new Error('Cannot read a directory');
    }

    if (st.size > MAX_FILE_READ_SIZE) {
      throw new Error(`File too large to edit (max ${Math.round(MAX_FILE_READ_SIZE / 1024 / 1024)} MB)`);
    }

    const content = await readFile(filePath, 'utf-8');
    return {
      content,
      size: st.size,
      modified: st.mtime.toISOString(),
    };
  }

  /**
   * Write string content to a file (UTF-8).
   */
  async writeFile(sourcePath: string, relativePath: string, content: string): Promise<void> {
    const filePath = this.resolveSafePath(sourcePath, relativePath);
    const dir = join(filePath, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, content, 'utf-8');
  }

  /**
   * Write raw binary content to a file (preserves binary data).
   */
  async writeFileRaw(sourcePath: string, relativePath: string, content: Buffer): Promise<void> {
    const filePath = this.resolveSafePath(sourcePath, relativePath);
    const dir = join(filePath, '..');
    await mkdir(dir, { recursive: true });
    await writeFile(filePath, content);
  }

  /**
   * Create a directory.
   */
  async createDirectory(sourcePath: string, relativePath: string): Promise<void> {
    const dirPath = this.resolveSafePath(sourcePath, relativePath);
    await mkdir(dirPath, { recursive: true });
  }

  /**
   * Delete a file or directory.
   */
  async deleteEntry(sourcePath: string, relativePath: string): Promise<void> {
    if (!relativePath || relativePath === '/' || relativePath === '.') {
      throw new Error('Cannot delete root directory');
    }
    const entryPath = this.resolveSafePath(sourcePath, relativePath);
    await rm(entryPath, { recursive: true, force: true });
  }

  /**
   * Get a readable stream for downloading a file.
   */
  downloadFile(sourcePath: string, relativePath: string): { stream: Readable; filename: string } {
    const filePath = this.resolveSafePath(sourcePath, relativePath);
    return {
      stream: Readable.from(createReadStream(filePath)),
      filename: basename(filePath),
    };
  }

  /**
   * Create a zip or tar archive of the source directory.
   */
  async createArchive(sourcePath: string, format: 'zip' | 'tar'): Promise<{ path: string; filename: string }> {
    const tmpFile = join(tmpdir(), `fleet-download-${randomUUID()}.${format === 'zip' ? 'zip' : 'tar.gz'}`);

    if (format === 'zip') {
      await execFile('zip', ['-r', '-q', tmpFile, '.'], {
        cwd: sourcePath,
        timeout: 120_000,
        maxBuffer: 50 * 1024 * 1024,
      });
    } else {
      await execFile('tar', ['-czf', tmpFile, '-C', sourcePath, '.'], {
        timeout: 120_000,
        maxBuffer: 50 * 1024 * 1024,
      });
    }

    return {
      path: tmpFile,
      filename: `project.${format === 'zip' ? 'zip' : 'tar.gz'}`,
    };
  }

  /**
   * Delete all uploaded files for a service.
   */
  async deleteServiceFiles(accountId: string, serviceId: string): Promise<void> {
    const servicePath = this.getServicePath(accountId, serviceId);
    await rm(servicePath, { recursive: true, force: true }).catch(() => {});

    // Clean up empty account directory
    const accountPath = join(UPLOAD_BASE, accountId);
    try {
      const remaining = await readdir(accountPath);
      if (remaining.length === 0) {
        await rm(accountPath, { recursive: true, force: true });
      }
    } catch {
      // Directory may not exist
    }
  }

  /**
   * Replace source files with new archive.
   */
  async replaceSource(opts: {
    accountId: string;
    serviceId: string;
    archivePath: string;
    archiveType: 'zip' | 'tar' | 'tar.gz';
  }): Promise<string> {
    const destPath = this.getServicePath(opts.accountId, opts.serviceId);
    // Remove old files but keep the directory
    await rm(destPath, { recursive: true, force: true });
    return this.extractAndStore(opts);
  }

  /**
   * Validate that all extracted files are within the destination directory (zip-slip protection).
   * Removes any files that escaped the boundary.
   */
  private async validateExtractedPaths(destPath: string): Promise<void> {
    const safeDirPrefix = destPath.endsWith('/') ? destPath : destPath + '/';
    const entries = await readdir(destPath);
    for (const entry of entries) {
      const fullPath = join(destPath, entry);
      const resolved = resolve(fullPath);
      if (resolved !== destPath && !resolved.startsWith(safeDirPrefix)) {
        await rm(fullPath, { recursive: true, force: true });
        continue;
      }
      const st = await lstat(fullPath);
      if (st.isDirectory()) {
        await this.validateExtractedPaths(fullPath);
      }
    }
  }

  /**
   * Remove symlinks that point outside the base directory.
   */
  private async removeUnsafeSymlinks(dirPath: string): Promise<void> {
    const safeDirPrefix = dirPath.endsWith('/') ? dirPath : dirPath + '/';
    const entries = await readdir(dirPath);
    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const st = await lstat(fullPath);
      if (st.isSymbolicLink()) {
        const target = await import('node:fs/promises').then(fs => fs.readlink(fullPath));
        const resolvedTarget = resolve(dirPath, target);
        // Use trailing-slash prefix to prevent /srv/uploads-evil matching /srv/uploads
        if (resolvedTarget !== dirPath && !resolvedTarget.startsWith(safeDirPrefix)) {
          await rm(fullPath);
        }
      } else if (st.isDirectory()) {
        await this.removeUnsafeSymlinks(fullPath);
      }
    }
  }

  /**
   * Calculate total directory size recursively.
   */
  private async getDirectorySize(dirPath: string): Promise<number> {
    let total = 0;
    const entries = await readdir(dirPath);
    for (const entry of entries) {
      const fullPath = join(dirPath, entry);
      const st = await lstat(fullPath);
      if (st.isDirectory()) {
        total += await this.getDirectorySize(fullPath);
      } else {
        total += st.size;
      }
    }
    return total;
  }

  /**
   * Get total upload directory size for an account in bytes.
   * Returns 0 if the account has no uploads.
   */
  async getAccountUploadSizeBytes(accountId: string): Promise<number> {
    const accountPath = join(UPLOAD_BASE, accountId);
    try {
      await stat(accountPath);
      // Wrap with timeout to prevent slow scans from blocking usage collection
      return await Promise.race([
        this.getDirectorySize(accountPath),
        new Promise<number>((_, reject) =>
          setTimeout(() => reject(new Error('Upload size scan timed out')), 10_000),
        ),
      ]);
    } catch {
      return 0;
    }
  }

  /**
   * Detect archive type from filename.
   */
  detectArchiveType(filename: string): 'zip' | 'tar' | 'tar.gz' | null {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.zip')) return 'zip';
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
    if (lower.endsWith('.tar')) return 'tar';
    return null;
  }
}

export const uploadService = new UploadService();
