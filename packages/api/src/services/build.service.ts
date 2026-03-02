import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { getValkey } from './valkey.service.js';
import { logger } from './logger.js';

const execFileAsync = promisify(execFile);

export type BuildStatus = 'pending' | 'cloning' | 'building' | 'pushing' | 'succeeded' | 'failed' | 'cancelled';

export interface BuildInfo {
  id: string;
  serviceId: string;
  status: BuildStatus;
  imageTag: string;
  log: string;
  startedAt: Date;
  finishedAt: Date | null;
}

const BUILD_DIR = process.env['BUILD_DIR'] ?? '/tmp/fleet-builds';
const REGISTRY_USER = process.env['REGISTRY_USER'] ?? 'fleet';
const REGISTRY_PASSWORD = process.env['REGISTRY_PASSWORD'] ?? '';

/**
 * Resolve the registry URL. Prefers DB platform domain over env var.
 * The registry is proxied through Traefik at https://<PLATFORM_DOMAIN>/v2/,
 * so the correct REGISTRY value is the platform domain (no port).
 * Legacy systems may still have localhost:5000 or IP:5000.
 */
async function resolveRegistryUrl(): Promise<string> {
  const raw = process.env['REGISTRY_URL'] ?? '';
  // If it's properly set to a domain (no port suffix), use it directly
  if (raw && !raw.match(/:\d+$/) && raw !== 'localhost') return raw;
  // Fall back to platform domain from DB (then env)
  try {
    const { getPlatformDomain } = await import('../routes/settings.js');
    const domain = await getPlatformDomain();
    if (domain && domain !== 'fleet.local') return domain;
  } catch { /* fall through */ }
  const domain = process.env['PLATFORM_DOMAIN'] ?? '';
  if (domain) return domain;
  // Last resort: use whatever was configured
  return raw || 'localhost:5000';
}

let _registryCache: string | null = null;
async function getRegistry(): Promise<string> {
  if (!_registryCache) _registryCache = await resolveRegistryUrl();
  return _registryCache;
}
const ORCHESTRATOR = process.env['ORCHESTRATOR'] ?? 'swarm';
const BUILDKIT_ADDR = process.env['BUILDKIT_ADDR'] ?? 'tcp://buildkitd.fleet-system:1234';

export function scrubSecrets(log: string): string {
  return log
    // Mask credentials embedded in URLs (e.g., https://x-access-token:TOKEN@github.com)
    .replace(/\/\/[^@\s]+@/g, '//[REDACTED]@')
    // Mask environment variable assignments with sensitive names
    .replace(/(?:PASSWORD|SECRET|TOKEN|KEY|CREDENTIAL|API_KEY|AUTH|PRIVATE|DATABASE_URL|REDIS_URL|MONGO_URI|DSN|CONNECTION_STRING)[\s]*[=:]\s*\S+/gi, (match) => {
      const eqIdx = match.search(/[=:]/);
      return match.slice(0, eqIdx + 1) + ' [REDACTED]';
    })
    // Mask Bearer tokens
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    // Mask base64-encoded strings that look like secrets (40+ chars)
    .replace(/(?:eyJ|ghp_|gho_|github_pat_|sk-|pk_live_|pk_test_|sk_live_|sk_test_|npm_[A-Za-z0-9])\S{20,}/g, '[REDACTED]')
    // Mask connection strings (postgres://, mysql://, mongodb://, redis://, amqp://)
    .replace(/(?:postgres|postgresql|mysql|mongodb|mongodb\+srv|redis|rediss|amqp|amqps):\/\/[^\s'"]+/gi, '[REDACTED_CONNECTION_STRING]')
    // Mask AWS-style keys
    .replace(/(?:AKIA|ASIA|ABIA|ACCA)[A-Z0-9]{16}/g, '[REDACTED_AWS_KEY]')
    // Mask Stripe/Sendgrid/Twilio keys
    .replace(/(?:sk_live_|rk_live_|whsec_|SG\.|AC[a-f0-9]{32})\S+/g, '[REDACTED]')
    // Mask Docker build --build-arg values with sensitive names
    .replace(/--build-arg\s+(?:PASSWORD|SECRET|TOKEN|KEY|AUTH|PRIVATE|API_KEY)[=]\S+/gi, '--build-arg [REDACTED]');
}

export class BuildService {
  private activeBuilds = new Map<string, { aborted: boolean; info: BuildInfo; processes: Set<import('node:child_process').ChildProcess> }>();
  private events = new EventEmitter();
  private registryLoggedIn = false;

  private async pushWithRetry(
    buildId: string,
    info: BuildInfo,
    imageTag: string,
    workDir: string,
    maxRetries = 2,
  ): Promise<void> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.loginToRegistry();
        await this.execStreaming(buildId, info, 'docker', ['push', imageTag], workDir, 600_000);
        return;
      } catch (err) {
        if (attempt < maxRetries) {
          const delay = (attempt + 1) * 3000;
          info.log += `\n[push] Push failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay / 1000}s...\n`;
          this.events.emit(`build:${buildId}`, info);
          await new Promise((r) => setTimeout(r, delay));
          this.registryLoggedIn = false; // Force re-login on retry
        } else {
          throw err;
        }
      }
    }
  }

  private async loginToRegistry(): Promise<void> {
    if (this.registryLoggedIn || !REGISTRY_PASSWORD) return;
    try {
      const reg = await getRegistry();
      await execFileAsync('docker', ['login', reg, '-u', REGISTRY_USER, '-p', REGISTRY_PASSWORD], {
        timeout: 15_000,
      });
      this.registryLoggedIn = true;
    } catch (err) {
      logger.warn({ err }, `Failed to login to registry`);
    }
  }

  async buildImage(opts: {
    serviceId: string;
    cloneUrl: string;
    branch: string;
    dockerfile?: string;
    imageTag: string;
    buildArgs?: Record<string, string>;
    generatedDockerfile?: string;
  }): Promise<BuildInfo> {
    const buildId = randomUUID();
    const workDir = join(BUILD_DIR, buildId);
    const dockerfile = opts.dockerfile ?? 'Dockerfile';
    // Validate dockerfile path — prevent directory traversal
    if (dockerfile.includes('..') || dockerfile.startsWith('/') || dockerfile.includes('\\')) {
      throw new Error('Invalid dockerfile path: must be relative without directory traversal');
    }
    const fullImageTag = `${await getRegistry()}/${opts.imageTag}`;

    const info: BuildInfo = {
      id: buildId,
      serviceId: opts.serviceId,
      status: 'pending',
      imageTag: fullImageTag,
      log: '',
      startedAt: new Date(),
      finishedAt: null,
    };

    this.activeBuilds.set(buildId, { aborted: false, info, processes: new Set() });

    // Run the build pipeline asynchronously
    // Pipeline's internal catch already sets status/log/emits — this is just a safety net
    this.runBuildPipeline(buildId, workDir, opts.cloneUrl, opts.branch, dockerfile, fullImageTag, opts.buildArgs ?? {}, info, opts.generatedDockerfile)
      .catch((err) => {
        if (info.status !== 'failed' && info.status !== 'cancelled') {
          info.status = 'failed';
          info.log += `\n[error] ${String(err)}`;
          info.finishedAt = new Date();
          this.events.emit(`build:${buildId}`, info);
        }
      });

    return info;
  }

  private async runBuildPipeline(
    buildId: string,
    workDir: string,
    cloneUrl: string,
    branch: string,
    dockerfile: string,
    imageTag: string,
    buildArgs: Record<string, string>,
    info: BuildInfo,
    generatedDockerfile?: string,
  ): Promise<void> {
    try {
      // 1. Clone
      info.status = 'cloning';
      info.log += `[clone] Cloning ${scrubSecrets(cloneUrl)} branch ${branch}...\n`;
      this.events.emit(`build:${buildId}`, info);

      await mkdir(workDir, { recursive: true });
      const cloneResult = await this.exec(
        'git',
        ['clone', '--depth', '1', '--branch', branch, cloneUrl, workDir],
        workDir,
        120_000, // 2 minute timeout for git clone
      );
      info.log += scrubSecrets(cloneResult);

      // Write auto-generated Dockerfile if provided
      if (generatedDockerfile) {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(join(workDir, dockerfile), generatedDockerfile, 'utf-8');
        info.log += `[detect] Auto-generated ${dockerfile} from runtime detection\n`;
        this.events.emit(`build:${buildId}`, info);
      }

      // 2. Build
      info.status = 'building';
      info.log += `\n[build] Building image ${imageTag} from ${dockerfile}...\n`;
      this.events.emit(`build:${buildId}`, info);

      const RESERVED_BUILD_ARGS = new Set([
        'HTTP_PROXY', 'HTTPS_PROXY', 'FTP_PROXY', 'NO_PROXY',
        'http_proxy', 'https_proxy', 'ftp_proxy', 'no_proxy',
        'PATH', 'HOME', 'USER', 'HOSTNAME',
        'DOCKER_BUILDKIT', 'DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_CONFIG',
        'BUILDKIT_PROGRESS', 'BUILDKIT_INLINE_CACHE', 'BUILDKIT_MULTI_PLATFORM',
        'SOURCE_DATE_EPOCH', 'TARGETPLATFORM', 'TARGETOS', 'TARGETARCH', 'TARGETVARIANT',
        'BUILDPLATFORM', 'BUILDOS', 'BUILDARCH', 'BUILDVARIANT',
      ]);

      if (ORCHESTRATOR === 'kubernetes') {
        // BuildKit: single command builds + pushes in one step
        const buildctlArgs = [
          '--addr', BUILDKIT_ADDR,
          'build',
          '--frontend', 'dockerfile.v0',
          '--local', `context=${workDir}`,
          '--local', `dockerfile=${workDir}`,
          '--opt', `filename=${dockerfile}`,
          '--output', `type=image,name=${imageTag},push=true`,
        ];
        for (const [key, val] of Object.entries(buildArgs)) {
          if (RESERVED_BUILD_ARGS.has(key)) continue;
          buildctlArgs.push('--opt', `build-arg:${key}=${val}`);
        }
        await this.execStreaming(buildId, info, 'buildctl', buildctlArgs, workDir, 600_000);
      } else {
        // Docker: build then push separately
        const buildCmdArgs = ['build', '-t', imageTag, '-f', join(workDir, dockerfile)];
        for (const [key, val] of Object.entries(buildArgs)) {
          if (RESERVED_BUILD_ARGS.has(key)) continue;
          buildCmdArgs.push('--build-arg', `${key}=${val}`);
        }
        buildCmdArgs.push(workDir);

        await this.execStreaming(buildId, info, 'docker', buildCmdArgs, workDir, 600_000);

        // 3. Push
        info.status = 'pushing';
        info.log += `\n[push] Pushing ${imageTag}...\n`;
        this.events.emit(`build:${buildId}`, info);

        await this.pushWithRetry(buildId, info, imageTag, workDir);
      }

      // Done
      info.status = 'succeeded';
      info.log += '\n[done] Build and push completed successfully.\n';
      info.finishedAt = new Date();
      this.events.emit(`build:${buildId}`, info);
    } catch (err) {
      if (info.status !== 'cancelled') {
        info.status = 'failed';
        info.log += `\n[error] ${String(err)}\n`;
      }
      info.finishedAt = new Date();
      this.events.emit(`build:${buildId}`, info);
      throw err;
    } finally {
      this.activeBuilds.delete(buildId);
      // Cleanup work directory
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private async exec(cmd: string, args: string[], cwd: string, timeout?: number): Promise<string> {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd,
        maxBuffer: 50 * 1024 * 1024, // 50MB
        timeout,
      });
      return stdout + (stderr ? `\n${stderr}` : '');
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean };
      // Scrub command args and output to prevent token leakage (e.g. git clone URLs with OAuth tokens)
      const safeArgs = scrubSecrets(args.join(' '));
      if (execErr.killed) {
        throw new Error(`Command "${cmd} ${safeArgs}" timed out after ${timeout}ms`);
      }
      const output = scrubSecrets((execErr.stdout ?? '') + (execErr.stderr ?? ''));
      throw new Error(`Command "${cmd} ${safeArgs}" failed with code ${execErr.code}\n${output}`);
    }
  }

  /**
   * Streaming exec — uses spawn to stream stdout/stderr line-by-line,
   * emitting build events in real-time so clients can see output as it happens.
   */
  private execStreaming(
    buildId: string,
    info: BuildInfo,
    cmd: string,
    args: string[],
    cwd: string,
    timeout?: number,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      // Track process for cancellation
      const build = this.activeBuilds.get(buildId);
      if (build) build.processes.add(proc);
      let output = '';
      let lastEmit = 0;
      const THROTTLE_MS = 100;
      let settled = false;

      const emitThrottled = () => {
        const now = Date.now();
        if (now - lastEmit >= THROTTLE_MS) {
          lastEmit = now;
          this.events.emit(`build:${buildId}`, info);
        }
      };

      // Cap log at 2MB to prevent unbounded memory growth during verbose builds.
      // At 1000 concurrent builds × 2MB = 2GB worst-case, which is manageable.
      const MAX_LOG_BYTES = 2 * 1024 * 1024;
      let logCapped = false;

      const handleLine = (line: string) => {
        if (!line) return;
        const scrubbed = scrubSecrets(line);
        // Cap output at same limit as info.log to prevent memory exhaustion
        if (output.length < MAX_LOG_BYTES) {
          output += scrubbed + '\n';
        }
        if (!logCapped) {
          if (info.log.length + scrubbed.length + 1 > MAX_LOG_BYTES) {
            info.log += '\n[log truncated — exceeded 2MB limit]\n';
            logCapped = true;
          } else {
            info.log += scrubbed + '\n';
          }
        }
        emitThrottled();
      };

      let stdoutBuf = '';
      proc.stdout!.on('data', (chunk: Buffer) => {
        stdoutBuf += chunk.toString();
        const lines = stdoutBuf.split('\n');
        stdoutBuf = lines.pop() ?? '';
        for (const line of lines) handleLine(line);
      });

      let stderrBuf = '';
      proc.stderr!.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString();
        const lines = stderrBuf.split('\n');
        stderrBuf = lines.pop() ?? '';
        for (const line of lines) handleLine(line);
      });

      const timer = timeout ? setTimeout(() => {
        if (!settled) {
          settled = true;
          proc.kill('SIGKILL');
          reject(new Error(`Command "${cmd}" timed out after ${timeout}ms`));
        }
      }, timeout) : null;

      proc.on('close', (code) => {
        if (build) build.processes.delete(proc);
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (stdoutBuf) handleLine(stdoutBuf);
        if (stderrBuf) handleLine(stderrBuf);
        this.events.emit(`build:${buildId}`, info);

        if (code === 0) resolve(output);
        else reject(new Error(`Command "${cmd}" failed with code ${code}\n${output}`));
      });

      proc.on('error', (err) => {
        if (build) build.processes.delete(proc);
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        reject(err);
      });
    });
  }

  async buildFromDirectory(opts: {
    serviceId: string;
    sourceDir: string;
    dockerfile?: string;
    imageTag: string;
    buildArgs?: Record<string, string>;
    generatedDockerfile?: string;
  }): Promise<BuildInfo> {
    const buildId = randomUUID();
    const workDir = join(BUILD_DIR, buildId);
    const dockerfile = opts.dockerfile ?? 'Dockerfile';
    if (dockerfile.includes('..') || dockerfile.startsWith('/') || dockerfile.includes('\\')) {
      throw new Error('Invalid dockerfile path: must be relative without directory traversal');
    }
    const fullImageTag = `${await getRegistry()}/${opts.imageTag}`;

    const info: BuildInfo = {
      id: buildId,
      serviceId: opts.serviceId,
      status: 'pending',
      imageTag: fullImageTag,
      log: '',
      startedAt: new Date(),
      finishedAt: null,
    };

    this.activeBuilds.set(buildId, { aborted: false, info, processes: new Set() });

    // Copy source to temp build dir, then build + push
    // Pipeline's internal catch already sets status/log/emits — this is just a safety net
    this.runDirectoryBuildPipeline(buildId, workDir, opts.sourceDir, dockerfile, fullImageTag, opts.buildArgs ?? {}, info, opts.generatedDockerfile)
      .catch((err) => {
        if (info.status !== 'failed' && info.status !== 'cancelled') {
          info.status = 'failed';
          info.log += `\n[error] ${String(err)}`;
          info.finishedAt = new Date();
          this.events.emit(`build:${buildId}`, info);
        }
      });

    return info;
  }

  private async runDirectoryBuildPipeline(
    buildId: string,
    workDir: string,
    sourceDir: string,
    dockerfile: string,
    imageTag: string,
    buildArgs: Record<string, string>,
    info: BuildInfo,
    generatedDockerfile?: string,
  ): Promise<void> {
    try {
      // 1. Copy source to temp build dir
      info.status = 'cloning';
      info.log += '[copy] Copying source files to build directory...\n';
      this.events.emit(`build:${buildId}`, info);

      await mkdir(workDir, { recursive: true });

      // Verify source directory exists before copying
      try {
        await stat(sourceDir);
      } catch {
        throw new Error(
          `Source directory not found: ${sourceDir}\n` +
          `Upload files may have been lost due to container restart. Please re-upload your project.`,
        );
      }

      await this.exec('cp', ['-r', `${sourceDir}/.`, workDir], workDir);

      // Write auto-generated Dockerfile if provided
      if (generatedDockerfile) {
        const { writeFile } = await import('node:fs/promises');
        await writeFile(join(workDir, dockerfile), generatedDockerfile, 'utf-8');
        info.log += `[detect] Auto-generated ${dockerfile} from runtime detection\n`;
        this.events.emit(`build:${buildId}`, info);
      }

      // 2. Build
      info.status = 'building';
      info.log += `\n[build] Building image ${imageTag} from ${dockerfile}...\n`;
      this.events.emit(`build:${buildId}`, info);

      const RESERVED_BUILD_ARGS = new Set([
        'HTTP_PROXY', 'HTTPS_PROXY', 'FTP_PROXY', 'NO_PROXY',
        'http_proxy', 'https_proxy', 'ftp_proxy', 'no_proxy',
        'PATH', 'HOME', 'USER', 'HOSTNAME',
        'DOCKER_BUILDKIT', 'DOCKER_HOST', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH', 'DOCKER_CONFIG',
        'BUILDKIT_PROGRESS', 'BUILDKIT_INLINE_CACHE', 'BUILDKIT_MULTI_PLATFORM',
        'SOURCE_DATE_EPOCH', 'TARGETPLATFORM', 'TARGETOS', 'TARGETARCH', 'TARGETVARIANT',
        'BUILDPLATFORM', 'BUILDOS', 'BUILDARCH', 'BUILDVARIANT',
      ]);

      if (ORCHESTRATOR === 'kubernetes') {
        const buildctlArgs = [
          '--addr', BUILDKIT_ADDR,
          'build',
          '--frontend', 'dockerfile.v0',
          '--local', `context=${workDir}`,
          '--local', `dockerfile=${workDir}`,
          '--opt', `filename=${dockerfile}`,
          '--output', `type=image,name=${imageTag},push=true`,
        ];
        for (const [key, val] of Object.entries(buildArgs)) {
          if (RESERVED_BUILD_ARGS.has(key)) continue;
          buildctlArgs.push('--opt', `build-arg:${key}=${val}`);
        }
        await this.execStreaming(buildId, info, 'buildctl', buildctlArgs, workDir, 600_000);
      } else {
        const buildCmdArgs = ['build', '-t', imageTag, '-f', join(workDir, dockerfile)];
        for (const [key, val] of Object.entries(buildArgs)) {
          if (RESERVED_BUILD_ARGS.has(key)) continue;
          buildCmdArgs.push('--build-arg', `${key}=${val}`);
        }
        buildCmdArgs.push(workDir);

        await this.execStreaming(buildId, info, 'docker', buildCmdArgs, workDir, 600_000);

        // 3. Push
        info.status = 'pushing';
        info.log += `\n[push] Pushing ${imageTag}...\n`;
        this.events.emit(`build:${buildId}`, info);

        await this.pushWithRetry(buildId, info, imageTag, workDir);
      }

      // Done
      info.status = 'succeeded';
      info.log += '\n[done] Build and push completed successfully.\n';
      info.finishedAt = new Date();
      this.events.emit(`build:${buildId}`, info);
    } catch (err) {
      if (info.status !== 'cancelled') {
        info.status = 'failed';
        info.log += `\n[error] ${String(err)}\n`;
      }
      info.finishedAt = new Date();
      this.events.emit(`build:${buildId}`, info);
      throw err;
    } finally {
      this.activeBuilds.delete(buildId);
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async buildFromCompose(opts: {
    serviceId: string;
    sourceDir: string;
    composeFile?: string;
    imageTag: string;
  }): Promise<BuildInfo> {
    const buildId = randomUUID();
    const workDir = join(BUILD_DIR, buildId);
    const composeFile = opts.composeFile ?? 'docker-compose.yml';
    if (composeFile.includes('..') || composeFile.startsWith('/') || composeFile.includes('\\')) {
      throw new Error('Invalid compose file path: must be relative without directory traversal');
    }
    const fullImageTag = `${await getRegistry()}/${opts.imageTag}`;

    const info: BuildInfo = {
      id: buildId,
      serviceId: opts.serviceId,
      status: 'pending',
      imageTag: fullImageTag,
      log: '',
      startedAt: new Date(),
      finishedAt: null,
    };

    this.activeBuilds.set(buildId, { aborted: false, info, processes: new Set() });

    // Pipeline's internal catch already sets status/log/emits — this is just a safety net
    this.runComposeBuildPipeline(buildId, workDir, opts.sourceDir, composeFile, fullImageTag, info)
      .catch((err) => {
        if (info.status !== 'failed' && info.status !== 'cancelled') {
          info.status = 'failed';
          info.log += `\n[error] ${String(err)}`;
          info.finishedAt = new Date();
          this.events.emit(`build:${buildId}`, info);
        }
      });

    return info;
  }

  private async runComposeBuildPipeline(
    buildId: string,
    workDir: string,
    sourceDir: string,
    composeFile: string,
    imageTag: string,
    info: BuildInfo,
  ): Promise<void> {
    try {
      // 1. Copy source to temp build dir
      info.status = 'cloning';
      info.log += '[copy] Copying source files to build directory...\n';
      this.events.emit(`build:${buildId}`, info);

      await mkdir(workDir, { recursive: true });

      // Verify source directory exists before copying
      try {
        await stat(sourceDir);
      } catch {
        throw new Error(
          `Source directory not found: ${sourceDir}\n` +
          `Upload files may have been lost due to container restart. Please re-upload your project.`,
        );
      }

      await this.exec('cp', ['-r', `${sourceDir}/.`, workDir], workDir);

      // 2. Build using docker compose
      info.status = 'building';
      info.log += `\n[build] Building with compose file ${composeFile}...\n`;
      this.events.emit(`build:${buildId}`, info);

      const projectName = `fleet-${buildId.slice(0, 8)}`;

      await this.execStreaming(
        buildId, info,
        'docker',
        ['compose', '-f', join(workDir, composeFile), '-p', projectName, 'build'],
        workDir,
        600_000,
      );

      // 3. Get the built service name
      const servicesOutput = await this.exec(
        'docker',
        ['compose', '-f', join(workDir, composeFile), '-p', projectName, 'config', '--services'],
        workDir,
      );
      const firstService = servicesOutput.trim().split('\n')[0]?.trim();
      if (!firstService) {
        throw new Error('No services found in compose file');
      }

      // The compose-built image is named <project>-<service>
      const composeBuildImage = `${projectName}-${firstService}`;
      info.log += `\n[tag] Tagging ${composeBuildImage} as ${imageTag}...\n`;
      this.events.emit(`build:${buildId}`, info);

      await this.exec('docker', ['tag', composeBuildImage, imageTag], workDir);

      // 4. Push (with retry for transient registry failures)
      info.status = 'pushing';
      info.log += `\n[push] Pushing ${imageTag}...\n`;
      this.events.emit(`build:${buildId}`, info);

      await this.pushWithRetry(buildId, info, imageTag, workDir);

      // Cleanup local compose image
      await this.exec('docker', ['rmi', composeBuildImage], workDir).catch(() => {});

      // Done
      info.status = 'succeeded';
      info.log += '\n[done] Compose build and push completed successfully.\n';
      info.finishedAt = new Date();
      this.events.emit(`build:${buildId}`, info);
    } catch (err) {
      if (info.status !== 'cancelled') {
        info.status = 'failed';
        info.log += `\n[error] ${String(err)}\n`;
      }
      info.finishedAt = new Date();
      this.events.emit(`build:${buildId}`, info);
      throw err;
    } finally {
      this.activeBuilds.delete(buildId);
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Initialize Valkey subscription for cross-replica build cancellation.
   * Call once on startup after Valkey is available.
   */
  async initCancelSubscription(): Promise<void> {
    try {
      const valkey = await getValkey();
      if (!valkey) return;

      const sub = valkey.duplicate();
      await sub.subscribe('fleet:build:cancel');
      sub.on('message', (_channel: string, buildId: string) => {
        if (this.activeBuilds.has(buildId)) {
          this.cancelBuildLocal(buildId);
        }
      });
    } catch (err) {
      logger.warn({ err }, 'Build cancel subscription failed — cross-replica cancellation disabled');
    }
  }

  private cancelBuildLocal(buildId: string): boolean {
    const build = this.activeBuilds.get(buildId);
    if (!build) return false;

    build.aborted = true;
    build.info.status = 'cancelled';
    build.info.log += '\n[cancelled] Build cancelled by user.\n';
    build.info.finishedAt = new Date();

    for (const proc of build.processes) {
      try { proc.kill('SIGKILL'); } catch { /* already exited */ }
    }
    build.processes.clear();

    this.activeBuilds.delete(buildId);
    this.events.emit(`build:${buildId}`, build.info);
    return true;
  }

  /**
   * Cancel a build — tries locally first, then publishes to Valkey
   * for cross-replica cancellation if the build isn't on this instance.
   */
  async cancelBuild(buildId: string): Promise<boolean> {
    // Try local first
    if (this.cancelBuildLocal(buildId)) return true;

    // Not on this replica — publish to Valkey for other replicas
    try {
      const valkey = await getValkey();
      if (valkey) {
        const subs = await valkey.publish('fleet:build:cancel', buildId);
        return subs > 0;
      }
    } catch { /* ignore */ }

    return false;
  }

  getBuildStatus(buildId: string): BuildInfo | null {
    const build = this.activeBuilds.get(buildId);
    return build?.info ?? null;
  }

  onBuildUpdate(buildId: string, callback: (info: BuildInfo) => void): () => void {
    const eventName = `build:${buildId}`;
    this.events.on(eventName, callback);
    return () => this.events.off(eventName, callback);
  }

  async detectDockerfile(cloneUrl: string, branch: string): Promise<{
    dockerfiles: string[];
    allFiles: string[];
  }> {
    const workDir = join(BUILD_DIR, `detect-${randomUUID()}`);
    try {
      await mkdir(workDir, { recursive: true });

      // Shallow clone with sparse checkout to just list files
      await this.exec(
        'git',
        ['clone', '--depth', '1', '--branch', branch, '--filter=blob:none', '--sparse', cloneUrl, workDir],
        workDir,
      );

      // List top-level files
      const output = await this.exec('git', ['ls-tree', '--name-only', 'HEAD'], workDir);
      const files = output.trim().split('\n').filter(Boolean);

      const dockerfiles: string[] = [];
      for (const file of files) {
        if (file === 'Dockerfile' || file.startsWith('Dockerfile.')) {
          dockerfiles.push(file);
        }
      }

      return {
        dockerfiles: dockerfiles.length > 0 ? dockerfiles : [],
        allFiles: files,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async cleanupImages(olderThanHours = 24): Promise<string> {
    if (ORCHESTRATOR === 'kubernetes') {
      // BuildKit manages its own cache — prune via buildctl
      try {
        return await this.exec(
          'buildctl',
          ['--addr', BUILDKIT_ADDR, 'prune'],
          '/tmp',
          30_000,
        );
      } catch (err) {
        return `BuildKit cleanup failed: ${String(err)}`;
      }
    }
    try {
      return await this.exec(
        'docker',
        ['image', 'prune', '-a', '--force', `--filter=until=${olderThanHours}h`],
        '/tmp',
      );
    } catch (err) {
      return `Cleanup failed: ${String(err)}`;
    }
  }
}

export const buildService = new BuildService();
