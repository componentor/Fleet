import Dockerode from 'dockerode';
import { Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { storageManager } from './storage/storage-manager.js';

const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });

export interface CreateSwarmServiceOptions {
  name: string;
  image: string;
  replicas: number;
  env: Record<string, string>;
  ports: Array<{ target: number; published: number; protocol?: string }>;
  volumes: Array<{ source: string; target: string; readonly?: boolean }>;
  labels: Record<string, string>;
  constraints: string[];
  cpuLimit?: number;
  memoryLimit?: number;
  healthCheck?: {
    cmd: string;
    interval: number;
    timeout: number;
    retries: number;
  };
  updateParallelism: number;
  updateDelay: string;
  rollbackOnFailure: boolean;
  networkId?: string;
  readOnly?: boolean;
  user?: string;
  /** Max container writable layer size in MB (e.g. 10240 = 10 GB). Requires overlay2 + xfs pquota. */
  storageLimitMb?: number;
  restartCondition?: 'none' | 'on-failure' | 'any';
  restartMaxAttempts?: number;
  restartDelay?: string;
}

export interface ServiceTaskInfo {
  id: string;
  nodeId: string;
  status: string;
  desiredState: string;
  message: string;
  error?: string;
  containerStatus?: {
    containerId: string;
    pid: number;
    exitCode?: number;
  };
  createdAt: string;
}

export class DockerService {
  private static readonly BLOCKED_MOUNT_SOURCES = [
    'docker.sock',
    '/var/run',
    '/var/run/',
    '/etc',
    '/etc/',
    '/proc',
    '/proc/',
    '/sys',
    '/sys/',
    '/dev',
    '/dev/',
  ];

  private validateVolumeMounts(volumes: CreateSwarmServiceOptions['volumes']): void {
    for (const v of volumes) {
      const src = v.source.toLowerCase().trim();
      // Block docker socket by name anywhere in the path
      if (src.includes('docker.sock')) {
        throw new Error('Mounting Docker socket is not allowed');
      }
      // Block sensitive host paths (exact match or sub-path)
      for (const blocked of DockerService.BLOCKED_MOUNT_SOURCES) {
        if (blocked === 'docker.sock') continue; // Already handled above
        if (src === blocked || src === blocked.replace(/\/$/, '') || src.startsWith(blocked.endsWith('/') ? blocked : `${blocked}/`)) {
          throw new Error(`Mounting host path '${v.source}' is not allowed — access to '${blocked}' is restricted`);
        }
      }
    }
  }

  async createService(opts: CreateSwarmServiceOptions): Promise<{ id: string }> {
    // Validate volume mounts — block dangerous host paths
    this.validateVolumeMounts(opts.volumes);

    const envArray = Object.entries(opts.env).map(([k, v]) => `${k}=${v}`);

    // Pass through Docker Compose labels to container spec (for Docker Desktop grouping)
    const containerLabels: Record<string, string> = {};
    if (opts.labels['com.docker.compose.project']) {
      containerLabels['com.docker.compose.project'] = opts.labels['com.docker.compose.project'];
    }
    if (opts.labels['com.docker.compose.service']) {
      containerLabels['com.docker.compose.service'] = opts.labels['com.docker.compose.service'];
    }

    const serviceSpec: Dockerode.CreateServiceOptions = {
      Name: opts.name,
      Labels: opts.labels,
      TaskTemplate: {
        ContainerSpec: {
          Image: opts.image,
          Env: envArray,
          Labels: Object.keys(containerLabels).length > 0 ? containerLabels : undefined,
          Mounts: opts.volumes.map((v) => {
            const driver = storageManager.volumes.getDockerVolumeDriver();
            const driverOpts = storageManager.volumes.getDockerVolumeOptions(v.source);
            return {
              Source: v.source,
              Target: v.target,
              Type: 'volume' as const,
              ReadOnly: v.readonly ?? false,
              VolumeOptions: driver !== 'local' ? {
                DriverConfig: { Name: driver, Options: driverOpts },
              } : undefined,
            };
          }),
          ...(opts.storageLimitMb ? {
            StorageOpt: { size: `${opts.storageLimitMb}M` },
          } : {}),
          HealthCheck: opts.healthCheck
            ? {
                Test: ['CMD-SHELL', opts.healthCheck.cmd],
                Interval: opts.healthCheck.interval * 1_000_000_000,
                Timeout: opts.healthCheck.timeout * 1_000_000_000,
                Retries: opts.healthCheck.retries,
              }
            : undefined,
          // Security hardening (opt-out for database/stateful images via readOnly: false)
          ReadOnly: opts.readOnly !== false,
          ...(opts.user !== undefined ? { User: opts.user } : opts.readOnly !== false ? { User: '1000' } : {}),
        },
        Resources: {
          Limits: {
            NanoCPUs: (opts.cpuLimit ?? 1) * 1e9,  // Convert CPU cores to nanocores
            MemoryBytes: (opts.memoryLimit ?? 512) * 1024 * 1024,  // Convert MB to bytes
          },
          Reservations: {
            NanoCPUs: Math.min((opts.cpuLimit ?? 1) * 0.25e9, 0.25e9),  // Reserve 25% of limit, min 0.25 CPU
            MemoryBytes: Math.min((opts.memoryLimit ?? 512) * 0.25 * 1024 * 1024, 128 * 1024 * 1024),  // Reserve 25% of limit, min 128MB
          },
        },
        RestartPolicy: {
          Condition: opts.restartCondition ?? 'on-failure',
          Delay: parseDelay(opts.restartDelay ?? '10s'),
          MaxAttempts: opts.restartMaxAttempts ?? 3,
          Window: 120_000_000_000,
        },
        Placement: {
          Constraints: opts.constraints,
        },
        Networks: opts.networkId
          ? [{ Target: opts.networkId }]
          : undefined,
      },
      Mode: {
        Replicated: {
          Replicas: opts.replicas,
        },
      },
      UpdateConfig: {
        Parallelism: opts.updateParallelism,
        Delay: parseDelay(opts.updateDelay),
        FailureAction: opts.rollbackOnFailure ? 'rollback' : 'pause',
        Order: 'start-first',
      },
      RollbackConfig: {
        Parallelism: 1,
        Delay: 5_000_000_000,
        FailureAction: 'pause',
        Order: 'stop-first',
      },
      EndpointSpec: {
        Ports: opts.ports.map((p) => ({
          TargetPort: p.target,
          PublishedPort: p.published,
          Protocol: (p.protocol ?? 'tcp') as 'tcp' | 'udp' | 'sctp',
          PublishMode: 'ingress' as const,
        })),
      },
    };

    const service = await docker.createService(serviceSpec);
    return { id: service.id };
  }

  async updateService(
    dockerServiceId: string,
    opts: Partial<CreateSwarmServiceOptions>,
  ): Promise<void> {
    // Validate volume mounts if volumes are being updated (defense-in-depth)
    if (opts.volumes) {
      this.validateVolumeMounts(opts.volumes);
    }

    const service = docker.getService(dockerServiceId);
    const info = await service.inspect();
    const version = info.Version.Index;
    const spec = info.Spec;

    if (opts.image) {
      spec.TaskTemplate.ContainerSpec.Image = opts.image;
    }

    if (opts.env) {
      spec.TaskTemplate.ContainerSpec.Env = Object.entries(opts.env).map(
        ([k, v]) => `${k}=${v}`,
      );
    }

    if (opts.replicas !== undefined) {
      spec.Mode.Replicated = { Replicas: opts.replicas };
    }

    if (opts.labels) {
      spec.Labels = { ...spec.Labels, ...opts.labels };
    }

    if (opts.readOnly !== undefined) {
      spec.TaskTemplate.ContainerSpec.ReadOnly = opts.readOnly;
    }

    if (opts.user !== undefined) {
      spec.TaskTemplate.ContainerSpec.User = opts.user;
    } else if (opts.readOnly === false) {
      // If switching to writable, remove the forced UID 1000
      delete spec.TaskTemplate.ContainerSpec.User;
    }

    if (opts.constraints) {
      spec.TaskTemplate.Placement = { Constraints: opts.constraints };
    }

    if (opts.ports) {
      spec.EndpointSpec = {
        Ports: opts.ports.map((p) => ({
          TargetPort: p.target,
          PublishedPort: p.published,
          Protocol: (p.protocol ?? 'tcp') as 'tcp' | 'udp' | 'sctp',
          PublishMode: 'ingress' as const,
        })),
      };
    }

    if (opts.restartCondition !== undefined || opts.restartMaxAttempts !== undefined || opts.restartDelay !== undefined) {
      const existing = spec.TaskTemplate.RestartPolicy ?? {};
      spec.TaskTemplate.RestartPolicy = {
        ...existing,
        ...(opts.restartCondition !== undefined ? { Condition: opts.restartCondition } : {}),
        ...(opts.restartMaxAttempts !== undefined ? { MaxAttempts: opts.restartMaxAttempts } : {}),
        ...(opts.restartDelay !== undefined ? { Delay: parseDelay(opts.restartDelay) } : {}),
      };
    }

    if (opts.updateParallelism !== undefined || opts.updateDelay !== undefined || opts.rollbackOnFailure !== undefined) {
      spec.UpdateConfig = {
        ...spec.UpdateConfig,
        ...(opts.updateParallelism !== undefined ? { Parallelism: opts.updateParallelism } : {}),
        ...(opts.updateDelay !== undefined ? { Delay: parseDelay(opts.updateDelay) } : {}),
        ...(opts.rollbackOnFailure !== undefined ? { FailureAction: opts.rollbackOnFailure ? 'rollback' : 'pause' } : {}),
      };
    }

    await service.update({ version, ...spec });
  }

  async removeService(dockerServiceId: string): Promise<void> {
    const service = docker.getService(dockerServiceId);
    await service.remove();
  }

  /**
   * Wait for all tasks of a removed service to fully stop.
   * Call after removeService() before cleaning up volumes.
   */
  async waitForServiceTasksGone(dockerServiceId: string, timeoutMs = 15000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const tasks = await docker.listTasks({ filters: { service: [dockerServiceId] } });
        const running = tasks.filter((t: any) => {
          const state = t.Status?.State;
          return state === 'running' || state === 'starting' || state === 'preparing';
        });
        if (running.length === 0) return;
      } catch {
        return; // Service gone entirely
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  async inspectService(dockerServiceId: string) {
    const service = docker.getService(dockerServiceId);
    return service.inspect();
  }

  async listServices(filters?: Record<string, string[]>) {
    return docker.listServices({ filters });
  }

  async listTasks(filters?: Record<string, string[]>) {
    return docker.listTasks({ filters });
  }

  async getServiceLogs(
    dockerServiceId: string,
    opts: { tail?: number; since?: number; follow?: boolean } = {},
  ): Promise<Buffer | NodeJS.ReadableStream> {
    const service = docker.getService(dockerServiceId);
    // Note: Dockerode returns a Buffer when follow=false, a ReadableStream when follow=true
    return service.logs({
      stdout: true,
      stderr: true,
      tail: opts.tail ?? 100,
      since: opts.since ?? 0,
      follow: opts.follow ?? false,
      timestamps: true,
    }) as Promise<Buffer | NodeJS.ReadableStream>;
  }

  async getServiceTasks(dockerServiceId: string): Promise<ServiceTaskInfo[]> {
    const tasks = await docker.listTasks({
      filters: { service: [dockerServiceId] },
    });

    return tasks.map((t) => ({
      id: t.ID,
      nodeId: t.NodeID,
      status: t.Status.State,
      desiredState: t.DesiredState,
      message: t.Status.Message ?? '',
      error: t.Status.Err ?? undefined,
      containerStatus: t.Status.ContainerStatus
        ? {
            containerId: t.Status.ContainerStatus.ContainerID,
            pid: t.Status.ContainerStatus.PID,
            exitCode: t.Status.ContainerStatus.ExitCode,
          }
        : undefined,
      createdAt: t.CreatedAt,
    }));
  }

  async scaleService(dockerServiceId: string, replicas: number): Promise<void> {
    await this.updateService(dockerServiceId, { replicas });
  }

  // Node management
  async listNodes() {
    return docker.listNodes();
  }

  async inspectNode(nodeId: string) {
    const node = docker.getNode(nodeId);
    return node.inspect();
  }

  async updateNode(
    nodeId: string,
    opts: { availability?: 'active' | 'pause' | 'drain'; role?: 'manager' | 'worker'; labels?: Record<string, string> },
  ): Promise<void> {
    const node = docker.getNode(nodeId);
    const info = await node.inspect();
    const version = info.Version.Index;

    const spec = { ...info.Spec };

    if (opts.availability) {
      spec.Availability = opts.availability;
    }
    if (opts.role) {
      spec.Role = opts.role;
    }
    if (opts.labels) {
      spec.Labels = { ...spec.Labels, ...opts.labels };
    }

    await node.update({ version, ...spec });
  }

  async drainNode(nodeId: string): Promise<void> {
    await this.updateNode(nodeId, { availability: 'drain' });
  }

  async activateNode(nodeId: string): Promise<void> {
    await this.updateNode(nodeId, { availability: 'active' });
  }

  async removeNode(nodeId: string, force = false): Promise<void> {
    const node = docker.getNode(nodeId);
    await node.remove({ force });
  }

  async getSwarmInfo() {
    return docker.swarmInspect();
  }

  async getSwarmJoinToken(): Promise<{ worker: string; manager: string }> {
    const info = await docker.swarmInspect();
    return {
      worker: info.JoinTokens.Worker,
      manager: info.JoinTokens.Manager,
    };
  }

  /**
   * Remove stopped/dead containers belonging to a specific swarm service.
   * Call before deploying a new version to prevent failed containers from piling up.
   */
  async pruneServiceContainers(dockerServiceId: string): Promise<number> {
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: [`com.docker.swarm.service.id=${dockerServiceId}`],
        status: ['exited', 'dead', 'created'],
      },
    });

    let removed = 0;
    for (const c of containers) {
      try {
        const container = docker.getContainer(c.Id);
        await container.remove({ force: true });
        removed++;
      } catch {
        // Container may already be gone — ignore
      }
    }
    return removed;
  }

  /**
   * Remove all stopped/dead containers with fleet labels (general prune).
   */
  async pruneDeadContainers(): Promise<number> {
    const containers = await docker.listContainers({
      all: true,
      filters: {
        label: ['fleet.service-id'],
        status: ['exited', 'dead', 'created'],
      },
    });

    let removed = 0;
    for (const c of containers) {
      try {
        const container = docker.getContainer(c.Id);
        await container.remove({ force: true });
        removed++;
      } catch {
        // ignore
      }
    }
    return removed;
  }

  /**
   * Configure swarm-level task history retention.
   * Limits how many completed/failed task records Docker keeps per service slot.
   */
  async configureTaskHistoryLimit(limit: number = 3): Promise<void> {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    await execFileAsync('docker', ['swarm', 'update', '--task-history-limit', String(limit)]);
  }

  // Network management for account isolation

  /**
   * Ensure an overlay network exists, creating it if necessary.
   * Returns the network ID for use in service specs.
   */
  async ensureNetwork(name: string): Promise<string> {
    const networks = await docker.listNetworks({ filters: { name: [name] } });
    const existing = networks.find((n: { Name: string }) => n.Name === name);
    if (existing) return existing.Id;
    const network = await docker.createNetwork({
      Name: name,
      Driver: 'overlay',
      Attachable: true,
    });
    return network.id;
  }

  async createNetwork(name: string, labels: Record<string, string> = {}): Promise<string> {
    const network = await docker.createNetwork({
      Name: name,
      Driver: 'overlay',
      Attachable: true,
      Labels: labels,
    });
    return network.id;
  }

  async removeNetwork(networkId: string): Promise<void> {
    const network = docker.getNetwork(networkId);
    await network.remove();
  }

  /**
   * Remove a Docker volume by name.
   * Retries up to 5 times with delays if the volume is still in use (409).
   */
  async removeVolume(name: string): Promise<boolean> {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 2000;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const volume = docker.getVolume(name);
        await volume.remove();
        return true;
      } catch (err: unknown) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404) return false;
        if (statusCode === 409 && attempt < MAX_RETRIES) {
          // Volume still in use — container is shutting down, wait and retry
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
          continue;
        }
        if (statusCode === 409) return false; // Exhausted retries
        throw err;
      }
    }
    return false;
  }

  // Container exec for terminal
  async execInContainer(
    containerId: string,
    cmd: string[] = ['/bin/sh'],
  ): Promise<{ stream: NodeJS.ReadWriteStream; execId: string }> {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
    });
    const stream = await exec.start({ hijack: true, stdin: true, Tty: true });
    return { stream, execId: exec.id };
  }

  // Non-interactive command execution (Tty: false for clean output)
  async execCommand(
    containerId: string,
    cmd: string[],
    timeoutMs: number = 30_000,
  ): Promise<{ stdout: string; exitCode: number }> {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const stream = await exec.start({ hijack: true, stdin: false, Tty: false });

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        stream.destroy();
        reject(new Error('Command timed out'));
      }, timeoutMs);

      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        // Cap at 2MB to prevent memory issues
        const total = chunks.reduce((sum, c) => sum + c.length, 0);
        if (total > 2 * 1024 * 1024) {
          clearTimeout(timer);
          stream.destroy();
          resolve({ stdout: Buffer.concat(chunks).toString('utf8').slice(0, 2 * 1024 * 1024), exitCode: 0 });
        }
      });

      stream.on('end', async () => {
        clearTimeout(timer);
        const output = Buffer.concat(chunks).toString('utf8');
        // Strip Docker stream header bytes (8 bytes per frame in non-TTY mode)
        const cleaned = output.replace(/[\x00-\x08]/g, '');
        try {
          const info = await exec.inspect();
          resolve({ stdout: cleaned, exitCode: info.ExitCode ?? 0 });
        } catch {
          resolve({ stdout: cleaned, exitCode: 0 });
        }
      });

      stream.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  // Streaming command execution — returns a readable stream of stdout (for large outputs like pg_dump)
  async execCommandStream(
    containerId: string,
    cmd: string[],
    timeoutMs: number = 300_000,
  ): Promise<{ stream: Readable; exec: Dockerode.Exec }> {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const rawStream = await exec.start({ hijack: true, stdin: false, Tty: false });

    // Demux Docker stream and return only stdout via a PassThrough
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    docker.modem.demuxStream(rawStream, stdout, stderr);

    const timer = setTimeout(() => {
      rawStream.destroy();
      stdout.destroy(new Error('Command timed out'));
    }, timeoutMs);

    rawStream.on('end', () => clearTimeout(timer));
    rawStream.on('error', () => clearTimeout(timer));
    stdout.on('close', () => clearTimeout(timer));

    return { stream: stdout, exec };
  }

  // Execute command with stdin input (for database restore)
  async execCommandWithInput(
    containerId: string,
    cmd: string[],
    input: Readable,
    timeoutMs: number = 600_000,
  ): Promise<{ exitCode: number; stderr: string }> {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });
    const rawStream = await exec.start({ hijack: true, stdin: true, Tty: false });

    return new Promise((resolve, reject) => {
      const errChunks: Buffer[] = [];
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      docker.modem.demuxStream(rawStream, stdout, stderr);

      stderr.on('data', (chunk: Buffer) => {
        const total = errChunks.reduce((sum, c) => sum + c.length, 0);
        if (total < 64 * 1024) errChunks.push(chunk);
      });

      const timer = setTimeout(() => {
        rawStream.destroy();
        reject(new Error('Command timed out'));
      }, timeoutMs);

      // Pipe input to the container's stdin
      input.pipe(rawStream, { end: true });

      // When rawStream ends, inspect exit code
      rawStream.on('end', async () => {
        clearTimeout(timer);
        try {
          const info = await exec.inspect();
          resolve({ exitCode: info.ExitCode ?? 0, stderr: Buffer.concat(errChunks).toString('utf8') });
        } catch {
          resolve({ exitCode: 0, stderr: Buffer.concat(errChunks).toString('utf8') });
        }
      });

      rawStream.on('error', (err: Error) => {
        clearTimeout(timer);
        reject(err);
      });

      input.on('error', (err: Error) => {
        clearTimeout(timer);
        rawStream.destroy();
        reject(err);
      });
    });
  }

  async resizeExec(execId: string, h: number, w: number): Promise<void> {
    const exec = docker.getExec(execId);
    await exec.resize({ h, w });
  }
}

function parseDelay(delay: string): number {
  const match = delay.match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) return 10_000_000_000; // default 10s in nanoseconds

  const value = parseInt(match[1]!, 10);
  const unit = match[2] ?? 's';

  const multipliers: Record<string, number> = {
    ms: 1_000_000,
    s: 1_000_000_000,
    m: 60_000_000_000,
    h: 3_600_000_000_000,
  };

  return value * (multipliers[unit] ?? 1_000_000_000);
}

export const dockerService = new DockerService();
