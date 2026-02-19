import { Server as SshServer, utils as ssh2Utils } from 'ssh2';
import type { Connection, Session } from 'ssh2';
import {
  readFileSync, existsSync, writeFileSync, mkdirSync,
  openSync, readSync, writeSync, closeSync, fstatSync,
} from 'node:fs';
import { readdir, stat, lstat, mkdir, rm, rename } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { verify } from 'argon2';
import { db, apiKeys, eq } from '@fleet/db';
import { logger } from './logger.js';

const SFTP_PORT = Number(process.env['SFTP_PORT'] ?? 2222);
const HOST_KEY_PATH = process.env['SFTP_HOST_KEY_PATH'] ?? './data/sftp_host_ed25519_key';
const MAX_CONNECTIONS = Number(process.env['SFTP_MAX_CONNECTIONS'] ?? 10000);
const MAX_CONNECTIONS_PER_ACCOUNT = Number(process.env['SFTP_MAX_PER_ACCOUNT'] ?? 100);
const AUTH_FAIL_WINDOW_MS = 60_000; // 1 minute window
const AUTH_FAIL_MAX = 10; // max failures per IP in window

const STATUS_CODE = ssh2Utils.sftp.STATUS_CODE;
const flagsToString = ssh2Utils.sftp.flagsToString;

// ── Connection tracking ──────────────────────────────────────────────

let totalConnections = 0;
const accountConnections = new Map<string, number>();
const authFailures = new Map<string, { count: number; firstFailAt: number }>();

function trackConnect(accountId: string): boolean {
  if (totalConnections >= MAX_CONNECTIONS) return false;
  const current = accountConnections.get(accountId) ?? 0;
  if (current >= MAX_CONNECTIONS_PER_ACCOUNT) return false;
  totalConnections++;
  accountConnections.set(accountId, current + 1);
  return true;
}

function trackDisconnect(accountId: string | null): void {
  totalConnections = Math.max(0, totalConnections - 1);
  if (accountId) {
    const current = accountConnections.get(accountId) ?? 1;
    if (current <= 1) accountConnections.delete(accountId);
    else accountConnections.set(accountId, current - 1);
  }
}

function isAuthRateLimited(ip: string): boolean {
  const entry = authFailures.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstFailAt > AUTH_FAIL_WINDOW_MS) {
    authFailures.delete(ip);
    return false;
  }
  return entry.count >= AUTH_FAIL_MAX;
}

function recordAuthFailure(ip: string): void {
  const entry = authFailures.get(ip);
  const now = Date.now();
  if (!entry || now - entry.firstFailAt > AUTH_FAIL_WINDOW_MS) {
    authFailures.set(ip, { count: 1, firstFailAt: now });
  } else {
    entry.count++;
  }
}

// Periodically clean up stale rate-limit entries (every 5 minutes)
const rateLimitCleanup = setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of authFailures) {
    if (now - entry.firstFailAt > AUTH_FAIL_WINDOW_MS) authFailures.delete(ip);
  }
}, 300_000);
rateLimitCleanup.unref();

// ── File handle using real file descriptors ──────────────────────────

interface FileHandle {
  type: 'file';
  path: string;
  fd: number;
  flags: string;
}

interface DirHandle {
  type: 'dir';
  path: string;
  listed: boolean;
}

type OpenHandle = FileHandle | DirHandle;

// ── Helpers ──────────────────────────────────────────────────────────

function getOrGenerateHostKey(): string {
  if (existsSync(HOST_KEY_PATH)) {
    return readFileSync(HOST_KEY_PATH, 'utf-8');
  }
  mkdirSync(dirname(HOST_KEY_PATH), { recursive: true });
  const keys = ssh2Utils.generateKeyPairSync('ed25519');
  writeFileSync(HOST_KEY_PATH, keys.private, { mode: 0o600 });
  logger.info('Generated new SFTP host key');
  return keys.private;
}

function resolveClientPath(userRoot: string, clientPath: string): string {
  let cleaned = clientPath.replace(/\\/g, '/');
  if (cleaned === '.' || cleaned === '' || cleaned === '/') return userRoot;
  cleaned = cleaned.replace(/^\/+/, '');
  if (cleaned.includes('..')) throw new Error('Path traversal');
  const resolved = resolve(userRoot, cleaned);
  if (!resolved.startsWith(userRoot + '/') && resolved !== userRoot) {
    throw new Error('Path traversal');
  }
  return resolved;
}

function formatLongname(name: string, st: { mode: number; size: number; mtime: Date; isDirectory: () => boolean }): string {
  const isDir = st.isDirectory();
  const prefix = isDir ? 'd' : '-';
  const size = String(st.size).padStart(10);
  const date = st.mtime.toISOString().slice(0, 10);
  return `${prefix}rwxr-xr-x 1 owner group ${size} ${date} ${name}`;
}

// ── SFTP Server ──────────────────────────────────────────────────────

export function startSftpServer(): SshServer {
  const hostKey = getOrGenerateHostKey();

  const sshServer = new SshServer({ hostKeys: [hostKey] }, (client: Connection) => {
    let userRoot: string | null = null;
    let connAccountId: string | null = null;
    const clientIp = (client as any)._sock?.remoteAddress ?? 'unknown';

    // Reject immediately if at global limit
    if (totalConnections >= MAX_CONNECTIONS) {
      logger.warn({ ip: clientIp }, 'SFTP connection rejected: global limit reached');
      client.end();
      return;
    }

    client.on('authentication', async (ctx) => {
      if (ctx.method !== 'password') {
        return ctx.reject(['password']);
      }

      // Rate-limit failed auth attempts per IP
      if (isAuthRateLimited(clientIp)) {
        logger.warn({ ip: clientIp }, 'SFTP auth rate-limited');
        return ctx.reject(['password']);
      }

      try {
        // Username format: "accountId/serviceId"
        const parts = ctx.username.split('/');
        const accountId = parts[0];
        const serviceId = parts[1];
        if (!accountId || !serviceId) {
          recordAuthFailure(clientIp);
          return ctx.reject(['password']);
        }

        const password = ctx.password;
        const prefix = password.slice(0, 14);
        const candidates = await db.query.apiKeys.findMany({
          where: eq(apiKeys.keyPrefix, prefix),
        });

        let authenticated = false;
        for (const candidate of candidates) {
          if (candidate.expiresAt && new Date(candidate.expiresAt) < new Date()) continue;
          if (candidate.accountId !== accountId) continue;

          const valid = await verify(candidate.keyHash, password);
          if (!valid) continue;

          // Enforce per-account connection limit
          if (!trackConnect(accountId)) {
            logger.warn({ accountId }, 'SFTP connection rejected: per-account limit reached');
            return ctx.reject(['password']);
          }

          connAccountId = accountId;
          const { uploadService } = await import('./upload.service.js');
          userRoot = uploadService.getServicePath(accountId, serviceId);
          await mkdir(userRoot, { recursive: true });

          logger.info({ accountId, serviceId, ip: clientIp }, 'SFTP user authenticated');
          authenticated = true;
          break;
        }

        if (authenticated) {
          ctx.accept();
        } else {
          recordAuthFailure(clientIp);
          ctx.reject(['password']);
        }
      } catch (err) {
        logger.error({ err }, 'SFTP auth error');
        ctx.reject();
      }
    });

    client.on('ready', () => {
      client.on('session', (accept: () => Session) => {
        const session = accept();
        session.on('sftp', (accept: () => any) => {
          const sftp = accept();
          const handles = new Map<number, OpenHandle>();
          let nextHandle = 0;

          function allocHandle(info: OpenHandle): Buffer {
            const id = nextHandle++;
            handles.set(id, info);
            const buf = Buffer.alloc(4);
            buf.writeUInt32BE(id, 0);
            return buf;
          }

          function getHandle(buf: Buffer): OpenHandle | undefined {
            return handles.get(buf.readUInt32BE(0));
          }

          function freeHandle(buf: Buffer): void {
            const id = buf.readUInt32BE(0);
            const h = handles.get(id);
            // Close real fd if it's a file handle
            if (h && h.type === 'file') {
              try { closeSync(h.fd); } catch { /* already closed */ }
            }
            handles.delete(id);
          }

          // Clean up all open fds when SFTP session ends
          sftp.on('end', () => {
            for (const h of handles.values()) {
              if (h.type === 'file') {
                try { closeSync(h.fd); } catch { /* ok */ }
              }
            }
            handles.clear();
          });

          sftp.on('OPEN', async (reqid: number, filename: string, flags: number) => {
            if (!userRoot) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            try {
              const fsPath = resolveClientPath(userRoot, filename);
              const mode = flagsToString(flags) ?? 'r';

              // Ensure parent directory exists for writes
              if (mode.includes('w') || mode.includes('a')) {
                await mkdir(dirname(fsPath), { recursive: true });
              }

              // Open with a real file descriptor — kept open for the lifetime of the handle
              const fd = openSync(fsPath, mode);
              const handle = allocHandle({ type: 'file', path: fsPath, fd, flags: mode });
              sftp.handle(reqid, handle);
            } catch {
              sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }
          });

          sftp.on('READ', (reqid: number, handleBuf: Buffer, offset: number, length: number) => {
            const h = getHandle(handleBuf);
            if (!h || h.type !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);
            try {
              // Read directly from fd at offset — no full-file buffering
              const buf = Buffer.alloc(Math.min(length, 65536));
              const bytesRead = readSync(h.fd, buf, 0, buf.length, offset);
              if (bytesRead === 0) return sftp.status(reqid, STATUS_CODE.EOF);
              sftp.data(reqid, buf.subarray(0, bytesRead));
            } catch {
              sftp.status(reqid, STATUS_CODE.FAILURE);
            }
          });

          sftp.on('WRITE', (reqid: number, handleBuf: Buffer, offset: number, data: Buffer) => {
            const h = getHandle(handleBuf);
            if (!h || h.type !== 'file') return sftp.status(reqid, STATUS_CODE.FAILURE);
            try {
              writeSync(h.fd, data, 0, data.length, offset);
              sftp.status(reqid, STATUS_CODE.OK);
            } catch {
              sftp.status(reqid, STATUS_CODE.FAILURE);
            }
          });

          sftp.on('CLOSE', (reqid: number, handleBuf: Buffer) => {
            freeHandle(handleBuf);
            sftp.status(reqid, STATUS_CODE.OK);
          });

          sftp.on('FSTAT', (reqid: number, handleBuf: Buffer) => {
            const h = getHandle(handleBuf);
            if (!h) return sftp.status(reqid, STATUS_CODE.FAILURE);
            try {
              if (h.type === 'file') {
                const st = fstatSync(h.fd);
                sftp.attrs(reqid, {
                  mode: st.mode, uid: st.uid, gid: st.gid, size: st.size,
                  atime: Math.floor(st.atimeMs / 1000),
                  mtime: Math.floor(st.mtimeMs / 1000),
                });
              } else {
                // dir handle — stat by path
                stat(h.path).then(st => {
                  sftp.attrs(reqid, {
                    mode: st.mode, uid: st.uid, gid: st.gid, size: st.size,
                    atime: Math.floor(st.atimeMs / 1000),
                    mtime: Math.floor(st.mtimeMs / 1000),
                  });
                }).catch(() => sftp.status(reqid, STATUS_CODE.FAILURE));
              }
            } catch {
              sftp.status(reqid, STATUS_CODE.FAILURE);
            }
          });

          const handleStat = async (reqid: number, path: string, statFn: typeof stat) => {
            if (!userRoot) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            try {
              const fsPath = resolveClientPath(userRoot, path);
              const st = await statFn(fsPath);
              sftp.attrs(reqid, {
                mode: st.mode, uid: st.uid, gid: st.gid, size: st.size,
                atime: Math.floor(st.atimeMs / 1000),
                mtime: Math.floor(st.mtimeMs / 1000),
              });
            } catch {
              sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }
          };

          sftp.on('STAT', (reqid: number, path: string) => handleStat(reqid, path, stat));
          sftp.on('LSTAT', (reqid: number, path: string) => handleStat(reqid, path, lstat));

          sftp.on('OPENDIR', async (reqid: number, path: string) => {
            if (!userRoot) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            try {
              const fsPath = resolveClientPath(userRoot, path);
              const st = await stat(fsPath);
              if (!st.isDirectory()) return sftp.status(reqid, STATUS_CODE.FAILURE);
              const handle = allocHandle({ type: 'dir', path: fsPath, listed: false });
              sftp.handle(reqid, handle);
            } catch {
              sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }
          });

          sftp.on('READDIR', async (reqid: number, handleBuf: Buffer) => {
            const h = getHandle(handleBuf);
            if (!h || h.type !== 'dir') return sftp.status(reqid, STATUS_CODE.FAILURE);
            if (h.listed) return sftp.status(reqid, STATUS_CODE.EOF);
            try {
              h.listed = true;
              const entries = await readdir(h.path);
              const names: Array<{ filename: string; longname: string; attrs: any }> = [];
              for (const name of entries) {
                try {
                  const st = await lstat(join(h.path, name));
                  names.push({
                    filename: name,
                    longname: formatLongname(name, st),
                    attrs: {
                      mode: st.mode, uid: st.uid, gid: st.gid, size: st.size,
                      atime: Math.floor(st.atimeMs / 1000),
                      mtime: Math.floor(st.mtimeMs / 1000),
                    },
                  });
                } catch { /* skip unreadable entries */ }
              }
              if (names.length === 0) return sftp.status(reqid, STATUS_CODE.EOF);
              sftp.name(reqid, names);
            } catch {
              sftp.status(reqid, STATUS_CODE.FAILURE);
            }
          });

          sftp.on('REALPATH', (reqid: number, path: string) => {
            if (!userRoot) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            try {
              const fsPath = resolveClientPath(userRoot, path);
              let virtualPath = fsPath.replace(userRoot, '') || '/';
              if (!virtualPath.startsWith('/')) virtualPath = '/' + virtualPath;
              sftp.name(reqid, [{ filename: virtualPath, longname: '', attrs: {} }]);
            } catch {
              sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }
          });

          sftp.on('MKDIR', async (reqid: number, path: string) => {
            if (!userRoot) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            try {
              await mkdir(resolveClientPath(userRoot, path), { recursive: true });
              sftp.status(reqid, STATUS_CODE.OK);
            } catch {
              sftp.status(reqid, STATUS_CODE.FAILURE);
            }
          });

          sftp.on('REMOVE', async (reqid: number, path: string) => {
            if (!userRoot) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            try {
              await rm(resolveClientPath(userRoot, path));
              sftp.status(reqid, STATUS_CODE.OK);
            } catch {
              sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }
          });

          sftp.on('RMDIR', async (reqid: number, path: string) => {
            if (!userRoot) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            try {
              await rm(resolveClientPath(userRoot, path), { recursive: true });
              sftp.status(reqid, STATUS_CODE.OK);
            } catch {
              sftp.status(reqid, STATUS_CODE.NO_SUCH_FILE);
            }
          });

          sftp.on('RENAME', async (reqid: number, oldPath: string, newPath: string) => {
            if (!userRoot) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED);
            try {
              await rename(resolveClientPath(userRoot, oldPath), resolveClientPath(userRoot, newPath));
              sftp.status(reqid, STATUS_CODE.OK);
            } catch {
              sftp.status(reqid, STATUS_CODE.FAILURE);
            }
          });

          sftp.on('SETSTAT', (reqid: number) => sftp.status(reqid, STATUS_CODE.OK));
          sftp.on('FSETSTAT', (reqid: number) => sftp.status(reqid, STATUS_CODE.OK));
        });
      });
    });

    client.on('close', () => {
      trackDisconnect(connAccountId);
    });

    client.on('error', (err: Error) => {
      logger.debug({ err: err.message }, 'SFTP client error');
    });
  });

  sshServer.listen(SFTP_PORT, '0.0.0.0', () => {
    logger.info({ port: SFTP_PORT, maxConnections: MAX_CONNECTIONS, maxPerAccount: MAX_CONNECTIONS_PER_ACCOUNT }, `SFTP server listening on port ${SFTP_PORT}`);
  });

  return sshServer;
}
