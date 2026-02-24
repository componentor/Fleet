import Dockerode from 'dockerode';
import { Readable, PassThrough } from 'node:stream';
import { resolve, posix } from 'node:path';
import { logger } from './logger.js';

const MAX_FILE_READ_SIZE = 10 * 1024 * 1024; // 10 MB
const MOUNT_PATH = '/vol';
const CONTAINER_IMAGE = 'alpine:latest';

export interface VolumeFileEntry {
  name: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

/**
 * Service for browsing and managing files inside Docker volumes.
 *
 * Uses temporary Alpine containers with the target volume mounted at /vol.
 * Follows the same lifecycle pattern as copyVolumeData() in docker.service.ts.
 */
export class VolumeFileService {
  private docker: Dockerode;

  constructor(docker: Dockerode) {
    this.docker = docker;
  }

  // ── Path safety ───────────────────────────────────────────────────────

  /** Resolve a relative path safely within /vol. Prevents traversal. */
  private safePath(relativePath: string): string {
    const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
    if (cleaned.includes('..')) throw new Error('Path traversal detected');
    if (!cleaned || cleaned === '/') return MOUNT_PATH;
    const resolved = posix.resolve(MOUNT_PATH, cleaned);
    if (!resolved.startsWith(MOUNT_PATH + '/') && resolved !== MOUNT_PATH) {
      throw new Error('Path traversal detected');
    }
    return resolved;
  }

  // ── Container lifecycle ───────────────────────────────────────────────

  /** Create a temporary container, run fn, then remove. */
  private async withContainer<T>(
    volumeName: string,
    fn: (container: Dockerode.Container) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    const container = await this.docker.createContainer({
      Image: CONTAINER_IMAGE,
      Cmd: ['sleep', '30'],
      HostConfig: {
        Binds: [`${volumeName}:${MOUNT_PATH}${readOnly ? ':ro' : ''}`],
        NetworkMode: 'none',
      },
    });
    try {
      await container.start();
      return await fn(container);
    } finally {
      await container.remove({ force: true }).catch(() => {});
    }
  }

  /**
   * Variant for streaming operations. Container is cleaned up when the
   * returned stream closes, NOT in a synchronous finally block.
   */
  private async streamFromContainer(
    volumeName: string,
    fn: (container: Dockerode.Container) => Promise<Readable>,
    readOnly = true,
  ): Promise<{ stream: Readable; cleanup: () => void }> {
    const container = await this.docker.createContainer({
      Image: CONTAINER_IMAGE,
      Cmd: ['sleep', '120'],
      HostConfig: {
        Binds: [`${volumeName}:${MOUNT_PATH}${readOnly ? ':ro' : ''}`],
        NetworkMode: 'none',
      },
    });
    await container.start();

    const cleanup = () => {
      container.remove({ force: true }).catch(() => {});
    };

    try {
      const stream = await fn(container);
      stream.on('end', cleanup);
      stream.on('error', cleanup);
      stream.on('close', cleanup);
      return { stream, cleanup };
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  // ── Exec helper ───────────────────────────────────────────────────────

  private async exec(
    container: Dockerode.Container,
    cmd: string[],
    timeoutMs = 30_000,
  ): Promise<{ stdout: string; exitCode: number }> {
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const rawStream = await exec.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    this.docker.modem.demuxStream(rawStream, stdout, stderr);

    let output = '';
    let errOutput = '';

    return new Promise<{ stdout: string; exitCode: number }>((res, rej) => {
      const timer = setTimeout(() => {
        rawStream.destroy();
        rej(new Error('Exec timed out'));
      }, timeoutMs);

      stdout.on('data', (chunk: Buffer) => {
        if (output.length < 2 * 1024 * 1024) output += chunk.toString();
      });
      stderr.on('data', (chunk: Buffer) => {
        if (errOutput.length < 64 * 1024) errOutput += chunk.toString();
      });

      rawStream.on('end', async () => {
        clearTimeout(timer);
        try {
          const info = await exec.inspect();
          const exitCode = info.ExitCode ?? -1;
          if (exitCode !== 0 && !output) {
            rej(new Error(errOutput.trim() || `Command failed with exit code ${exitCode}`));
          } else {
            res({ stdout: output, exitCode });
          }
        } catch {
          res({ stdout: output, exitCode: -1 });
        }
      });

      rawStream.on('error', (err: Error) => {
        clearTimeout(timer);
        rej(err);
      });
    });
  }

  /** Exec that returns a Readable stream (for large outputs). */
  private async execStream(
    container: Dockerode.Container,
    cmd: string[],
  ): Promise<Readable> {
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const rawStream = await exec.start({ hijack: true, stdin: false });
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    this.docker.modem.demuxStream(rawStream, stdout, stderr);

    // Discard stderr
    stderr.resume();

    return stdout;
  }

  // ── Public API ────────────────────────────────────────────────────────

  async listDirectory(volumeName: string, relativePath = '/'): Promise<VolumeFileEntry[]> {
    const dirPath = this.safePath(relativePath);

    return this.withContainer(volumeName, async (container) => {
      // Use stat-based listing for reliability
      const { stdout, exitCode } = await this.exec(container, [
        'sh', '-c',
        // For each entry: type(d/f) TAB size TAB mtime_epoch TAB name
        `cd "${dirPath}" 2>/dev/null && for f in * .[!.]* ..?*; do `
        + `[ -e "$f" ] || continue; `
        + `if [ -d "$f" ]; then t=d; else t=f; fi; `
        + `s=$(stat -c '%s' "$f" 2>/dev/null || echo 0); `
        + `m=$(stat -c '%Y' "$f" 2>/dev/null || echo 0); `
        + `printf '%s\\t%s\\t%s\\t%s\\n' "$t" "$s" "$m" "$f"; `
        + `done`,
      ]);

      if (exitCode !== 0 && !stdout.trim()) return [];

      const entries: VolumeFileEntry[] = [];
      for (const line of stdout.trim().split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        if (parts.length < 4) continue;

        const [typeChar, sizeStr, mtimeStr, ...nameParts] = parts;
        const name = nameParts.join('\t'); // handle tab in filename (rare)
        if (!name || name === '.' || name === '..') continue;
        // Skip .git directory
        if (name === '.git') continue;

        entries.push({
          name,
          type: typeChar === 'd' ? 'directory' : 'file',
          size: typeChar === 'd' ? 0 : parseInt(sizeStr!, 10) || 0,
          modified: new Date(parseInt(mtimeStr!, 10) * 1000).toISOString(),
        });
      }

      // Sort: directories first, then alphabetical
      entries.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      return entries;
    }, true);
  }

  async readFile(volumeName: string, relativePath: string): Promise<{
    content: string;
    size: number;
    modified: string;
  }> {
    const filePath = this.safePath(relativePath);

    return this.withContainer(volumeName, async (container) => {
      // Check size first
      const { stdout: statOut } = await this.exec(container, [
        'stat', '-c', '%s %Y %F', filePath,
      ]);
      const [sizeStr, mtimeStr, typeStr] = statOut.trim().split(' ');
      if (typeStr === 'directory') throw new Error('Cannot read a directory');

      const size = parseInt(sizeStr!, 10);
      if (size > MAX_FILE_READ_SIZE) {
        throw new Error(`File too large to edit (max ${Math.round(MAX_FILE_READ_SIZE / 1024 / 1024)} MB)`);
      }

      const { stdout: content } = await this.exec(container, ['cat', filePath]);

      return {
        content,
        size,
        modified: new Date(parseInt(mtimeStr!, 10) * 1000).toISOString(),
      };
    }, true);
  }

  async writeFile(volumeName: string, relativePath: string, content: string): Promise<void> {
    const filePath = this.safePath(relativePath);
    const dir = filePath.substring(0, filePath.lastIndexOf('/')) || MOUNT_PATH;

    return this.withContainer(volumeName, async (container) => {
      // Ensure parent dir exists
      await this.exec(container, ['mkdir', '-p', dir]);

      // Write via sh -c with heredoc-like approach, using base64 to handle special chars
      const encoded = Buffer.from(content, 'utf-8').toString('base64');
      await this.exec(container, [
        'sh', '-c', `echo '${encoded}' | base64 -d > "${filePath}"`,
      ]);
    });
  }

  async writeFileRaw(volumeName: string, relativePath: string, data: Buffer): Promise<void> {
    const filePath = this.safePath(relativePath);
    const dir = filePath.substring(0, filePath.lastIndexOf('/')) || MOUNT_PATH;

    return this.withContainer(volumeName, async (container) => {
      // Ensure parent dir exists
      await this.exec(container, ['mkdir', '-p', dir]);

      // Encode data as base64 and decode on the container side
      const b64 = data.toString('base64');
      // Split into chunks for large files to avoid argument length limits
      const chunkSize = 65536;
      if (b64.length <= chunkSize) {
        await this.exec(container, ['sh', '-c', `echo '${b64}' | base64 -d > '${filePath}'`]);
      } else {
        // Write base64 chunks to a temp file then decode
        const tmpFile = `${filePath}.b64tmp`;
        await this.exec(container, ['sh', '-c', `true > '${tmpFile}'`]);
        for (let i = 0; i < b64.length; i += chunkSize) {
          const chunk = b64.substring(i, i + chunkSize);
          await this.exec(container, ['sh', '-c', `echo '${chunk}' >> '${tmpFile}'`]);
        }
        await this.exec(container, ['sh', '-c', `base64 -d '${tmpFile}' > '${filePath}' && rm -f '${tmpFile}'`]);
      }
    });
  }

  async createDirectory(volumeName: string, relativePath: string): Promise<void> {
    const dirPath = this.safePath(relativePath);

    return this.withContainer(volumeName, async (container) => {
      await this.exec(container, ['mkdir', '-p', dirPath]);
    });
  }

  async deleteEntry(volumeName: string, relativePath: string): Promise<void> {
    if (!relativePath || relativePath === '/' || relativePath === '.') {
      throw new Error('Cannot delete root directory');
    }
    const entryPath = this.safePath(relativePath);

    return this.withContainer(volumeName, async (container) => {
      await this.exec(container, ['rm', '-rf', entryPath]);
    });
  }

  async downloadFile(volumeName: string, relativePath: string): Promise<{
    stream: Readable;
    filename: string;
  }> {
    const filePath = this.safePath(relativePath);
    const filename = filePath.substring(filePath.lastIndexOf('/') + 1);

    const { stream } = await this.streamFromContainer(volumeName, async (container) => {
      // Stream the file directly via cat
      return this.execStream(container, ['cat', filePath]);
    });

    return { stream, filename };
  }

  async downloadArchive(volumeName: string, format: 'zip' | 'tar'): Promise<{
    stream: Readable;
  }> {
    const { stream } = await this.streamFromContainer(volumeName, async (container) => {
      if (format === 'tar') {
        return this.execStream(container, [
          'tar', 'czf', '-', '-C', MOUNT_PATH, '.',
        ]);
      }
      // zip: install zip first, then stream
      await this.exec(container, ['apk', 'add', '--no-cache', 'zip']);
      return this.execStream(container, [
        'sh', '-c', `cd ${MOUNT_PATH} && zip -r - .`,
      ]);
    });

    return { stream };
  }
}
