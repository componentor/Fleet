import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';

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

const BUILD_DIR = process.env['BUILD_DIR'] ?? '/tmp/hoster-builds';
const REGISTRY = process.env['REGISTRY_URL'] ?? 'localhost:5000';

export class BuildService {
  private activeBuilds = new Map<string, { aborted: boolean; info: BuildInfo }>();
  private events = new EventEmitter();

  async buildImage(opts: {
    serviceId: string;
    cloneUrl: string;
    branch: string;
    dockerfile?: string;
    imageTag: string;
    buildArgs?: Record<string, string>;
  }): Promise<BuildInfo> {
    const buildId = randomUUID();
    const workDir = join(BUILD_DIR, buildId);
    const dockerfile = opts.dockerfile ?? 'Dockerfile';
    const fullImageTag = `${REGISTRY}/${opts.imageTag}`;

    const info: BuildInfo = {
      id: buildId,
      serviceId: opts.serviceId,
      status: 'pending',
      imageTag: fullImageTag,
      log: '',
      startedAt: new Date(),
      finishedAt: null,
    };

    this.activeBuilds.set(buildId, { aborted: false, info });

    // Run the build pipeline asynchronously
    this.runBuildPipeline(buildId, workDir, opts.cloneUrl, opts.branch, dockerfile, fullImageTag, opts.buildArgs ?? {}, info)
      .catch((err) => {
        if (info.status !== 'cancelled') {
          info.status = 'failed';
          info.log += `\n[error] ${String(err)}`;
        }
        info.finishedAt = new Date();
        this.events.emit(`build:${buildId}`, info);
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
  ): Promise<void> {
    try {
      // 1. Clone
      info.status = 'cloning';
      info.log += `[clone] Cloning ${cloneUrl} branch ${branch}...\n`;
      this.events.emit(`build:${buildId}`, info);

      await mkdir(workDir, { recursive: true });
      const cloneResult = await this.exec(
        'git',
        ['clone', '--depth', '1', '--branch', branch, cloneUrl, workDir],
        workDir,
      );
      info.log += cloneResult;

      // 2. Build
      info.status = 'building';
      info.log += `\n[build] Building image ${imageTag} from ${dockerfile}...\n`;
      this.events.emit(`build:${buildId}`, info);

      const buildCmdArgs = ['build', '-t', imageTag, '-f', join(workDir, dockerfile)];
      for (const [key, val] of Object.entries(buildArgs)) {
        buildCmdArgs.push('--build-arg', `${key}=${val}`);
      }
      buildCmdArgs.push(workDir);

      const buildLog = await this.exec('docker', buildCmdArgs, workDir);
      info.log += buildLog;

      // 3. Push
      info.status = 'pushing';
      info.log += `\n[push] Pushing ${imageTag}...\n`;
      this.events.emit(`build:${buildId}`, info);

      const pushLog = await this.exec('docker', ['push', imageTag], workDir);
      info.log += pushLog;

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

  private async exec(cmd: string, args: string[], cwd: string): Promise<string> {
    try {
      const { stdout, stderr } = await execFileAsync(cmd, args, {
        cwd,
        maxBuffer: 50 * 1024 * 1024, // 50MB
      });
      return stdout + (stderr ? `\n${stderr}` : '');
    } catch (err: unknown) {
      const execErr = err as { stdout?: string; stderr?: string; code?: number };
      const output = (execErr.stdout ?? '') + (execErr.stderr ?? '');
      throw new Error(`Command "${cmd} ${args.join(' ')}" failed with code ${execErr.code}\n${output}`);
    }
  }

  cancelBuild(buildId: string): boolean {
    const build = this.activeBuilds.get(buildId);
    if (!build) return false;

    build.aborted = true;
    build.info.status = 'cancelled';
    build.info.log += '\n[cancelled] Build cancelled by user.\n';
    build.info.finishedAt = new Date();
    this.activeBuilds.delete(buildId);
    this.events.emit(`build:${buildId}`, build.info);
    return true;
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

  async detectDockerfile(cloneUrl: string, branch: string): Promise<string[]> {
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
      const files = output.trim().split('\n');

      const dockerfiles: string[] = [];
      for (const file of files) {
        if (file === 'Dockerfile' || file.startsWith('Dockerfile.')) {
          dockerfiles.push(file);
        }
      }

      return dockerfiles.length > 0 ? dockerfiles : ['Dockerfile'];
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  async cleanupImages(olderThanHours = 24): Promise<string> {
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
