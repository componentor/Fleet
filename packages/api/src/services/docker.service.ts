import Dockerode from 'dockerode';
import { resolve as resolvePath } from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { storageManager } from './storage/storage-manager.js';
import { logger } from './logger.js';

const PLATFORM_CERTS_VOLUME = 'fleet-platform-certs';

const docker = new Dockerode({ socketPath: '/var/run/docker.sock', version: 'v1.45' });

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
  networkIds?: string[];
  readOnly?: boolean;
  user?: string;
  /** Max container writable layer size in MB (e.g. 10240 = 10 GB). Requires overlay2 + xfs pquota. */
  storageLimitMb?: number;
  restartCondition?: 'none' | 'on-failure' | 'any';
  restartMaxAttempts?: number;
  restartDelay?: string;
}

export interface ContainerStats {
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  memoryPercent: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  pids: number;
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
  /** Expose the raw Dockerode client for advanced operations. */
  getDockerClient(): Dockerode {
    return docker;
  }

  private static readonly BLOCKED_MOUNT_SOURCES = [
    'docker.sock',
    '/var/run',
    '/var/run/',
    '/var/lib/docker',
    '/var/lib/docker/',
    '/etc',
    '/etc/',
    '/proc',
    '/proc/',
    '/sys',
    '/sys/',
    '/dev',
    '/dev/',
    '/root',
    '/root/',
  ];

  private validateVolumeMounts(volumes: CreateSwarmServiceOptions['volumes']): void {
    for (const v of volumes) {
      // Resolve path to prevent traversal via ../ sequences
      const resolved = resolvePath(v.source);
      const src = resolved.toLowerCase().trim();
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

  /**
   * Ensure all volume host paths exist before Docker tries to bind-mount them.
   *
   * For distributed storage (GlusterFS) the directories must exist on EVERY
   * Swarm node, not just the manager, because Docker may schedule the task on
   * any node.  A single `docker.createContainer` only runs on the manager,
   * leaving worker nodes with stale FUSE caches or missing directories.
   *
   * Fix: use `runOnAllNodes()` to execute `mkdir -p` on every Swarm node via
   * a global one-shot service.  This refreshes each node's FUSE metadata cache
   * and guarantees the bind-mount source exists everywhere.
   */
  private async ensureVolumeMounts(volumes: { source: string; target: string; readonly?: boolean }[]): Promise<void> {
    try {
      if (!storageManager.volumes.isReady()) return;
      if (!storageManager.volumes.getHostMountPath) return;

      // Collect full host paths that need to exist on every node
      const hostPaths: string[] = [];
      for (const v of volumes) {
        const hp = storageManager.volumes.getHostMountPath(v.source);
        if (hp) hostPaths.push(hp);
      }
      if (hostPaths.length === 0) return;

      // Build a single shell command that creates + verifies all directories
      const cmd = hostPaths
        .map(p => `mkdir -p "${p}" && chmod 777 "${p}" && stat "${p}" > /dev/null`)
        .join(' && ');

      logger.info({ volumes: hostPaths }, 'Ensuring volume directories on all Swarm nodes');
      const result = await this.runOnAllNodes(cmd, { timeoutMs: 30_000 });

      const failed = result.results.filter(r => r.status !== 'complete');
      if (failed.length > 0) {
        const details = failed.map(r => `node=${r.nodeId} err=${r.error ?? r.status}`).join('; ');
        if (!result.success) {
          // All nodes failed — storage mount is likely broken
          const mountBase = hostPaths[0]!.substring(0, hostPaths[0]!.lastIndexOf('/'));
          throw new Error(
            `Volume directories could not be created on any node. ` +
            `The distributed storage mount (${mountBase}) may be disconnected. ` +
            `Try remounting on affected nodes. Details: ${details}`,
          );
        }
        logger.warn({ failed: failed.length, total: result.results.length, details },
          'Volume ensure failed on some nodes — service may fail if scheduled there');
      }
    } catch (err) {
      throw new Error(`Volume preparation failed: ${(err as Error).message}`);
    }
  }

  async createService(opts: CreateSwarmServiceOptions): Promise<{ id: string }> {
    // Validate volume mounts — block dangerous host paths
    this.validateVolumeMounts(opts.volumes);

    // Ensure volume directories exist before Docker tries to bind-mount them
    await this.ensureVolumeMounts(opts.volumes);

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
            // Check if provider uses host-level mounts (e.g. GlusterFS FUSE)
            let hostPath: string | null = null;
            try {
              if (storageManager.volumes.isReady() && storageManager.volumes.getHostMountPath) {
                hostPath = storageManager.volumes.getHostMountPath(v.source);
              }
            } catch { /* storage not initialized */ }

            if (hostPath) {
              // Use bind mount from host-level FUSE/kernel mount
              return {
                Source: hostPath,
                Target: v.target,
                Type: 'bind' as const,
                ReadOnly: v.readonly ?? false,
              };
            }

            // Fall back to Docker volume driver
            let driver = 'local';
            let driverOpts: Record<string, string> = {};
            try {
              if (storageManager.volumes.isReady()) {
                driver = storageManager.volumes.getDockerVolumeDriver();
                driverOpts = storageManager.volumes.getDockerVolumeOptions(v.source);
              }
            } catch { /* storage not initialized — use local */ }
            const hasDriverOpts = Object.keys(driverOpts).length > 0;
            return {
              Source: v.source,
              Target: v.target,
              Type: 'volume' as const,
              ReadOnly: v.readonly ?? false,
              VolumeOptions: hasDriverOpts ? {
                NoCopy: false,
                Labels: {},
                DriverConfig: { Name: driver, Options: driverOpts },
              } : undefined,
            };
          }),
          ...(opts.storageLimitMb ? {
            StorageOpt: { size: `${opts.storageLimitMb}M` },
          } : {}),
          HealthCheck: opts.healthCheck
            ? {
                Test: ['CMD', '/bin/sh', '-c', opts.healthCheck.cmd],
                Interval: opts.healthCheck.interval * 1_000_000_000,
                Timeout: opts.healthCheck.timeout * 1_000_000_000,
                Retries: opts.healthCheck.retries,
              }
            : undefined,
          // Security: only apply ReadOnly / custom User when explicitly requested
          ...(opts.readOnly === true ? { ReadOnly: true } : {}),
          ...(opts.user !== undefined ? { User: opts.user } : {}),
        },
        Resources: {
          Limits: {
            NanoCPUs: (opts.cpuLimit ?? 1) * 1e9,  // Convert CPU cores to nanocores
            MemoryBytes: (opts.memoryLimit ?? 1024) * 1024 * 1024,  // Convert MB to bytes (1 GB default)
          },
          Reservations: {
            NanoCPUs: Math.min((opts.cpuLimit ?? 1) * 0.25e9, 0.25e9),  // Reserve 25% of limit, min 0.25 CPU
            MemoryBytes: Math.min((opts.memoryLimit ?? 1024) * 0.25 * 1024 * 1024, 256 * 1024 * 1024),  // Reserve 25% of limit, min 256MB
          },
        },
        RestartPolicy: {
          Condition: opts.restartCondition ?? 'on-failure',
          Delay: parseDelay(opts.restartDelay ?? '10s'),
          MaxAttempts: opts.restartMaxAttempts ?? 5,
          Window: 300_000_000_000,  // 5-minute window
        },
        Placement: {
          Constraints: opts.constraints,
        },
        Networks: opts.networkIds?.length
          ? opts.networkIds.map((id) => ({ Target: id }))
          : opts.networkId
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
      await this.ensureVolumeMounts(opts.volumes);
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

    if (opts.volumes) {
      spec.TaskTemplate.ContainerSpec.Mounts = opts.volumes.map((v) => {
        // Check if provider uses host-level mounts (e.g. GlusterFS FUSE)
        let hostPath: string | null = null;
        try {
          if (storageManager.volumes.isReady() && storageManager.volumes.getHostMountPath) {
            hostPath = storageManager.volumes.getHostMountPath(v.source);
          }
        } catch { /* storage not initialized */ }

        if (hostPath) {
          return {
            Source: hostPath,
            Target: v.target,
            Type: 'bind' as const,
            ReadOnly: v.readonly ?? false,
          };
        }

        // Fall back to Docker volume driver
        let driver = 'local';
        let driverOpts: Record<string, string> = {};
        try {
          if (storageManager.volumes.isReady()) {
            driver = storageManager.volumes.getDockerVolumeDriver();
            driverOpts = storageManager.volumes.getDockerVolumeOptions(v.source);
          }
        } catch { /* storage not initialized — use local */ }
        const hasDriverOpts = Object.keys(driverOpts).length > 0;
        return {
          Source: v.source,
          Target: v.target,
          Type: 'volume' as const,
          ReadOnly: v.readonly ?? false,
          VolumeOptions: hasDriverOpts ? {
            NoCopy: false,
            Labels: {},
            DriverConfig: { Name: driver, Options: driverOpts },
          } : undefined,
        };
      });
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

    if (opts.cpuLimit !== undefined || opts.memoryLimit !== undefined) {
      spec.TaskTemplate.Resources = spec.TaskTemplate.Resources ?? {};
      spec.TaskTemplate.Resources.Limits = {
        ...spec.TaskTemplate.Resources.Limits,
        ...(opts.cpuLimit !== undefined ? { NanoCPUs: opts.cpuLimit * 1e9 } : {}),
        ...(opts.memoryLimit !== undefined ? { MemoryBytes: opts.memoryLimit * 1024 * 1024 } : {}),
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

    if (opts.networkIds?.length) {
      spec.TaskTemplate.Networks = opts.networkIds.map((id) => ({ Target: id }));
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

  /**
   * Get all published ingress ports currently in use across all Swarm services.
   */
  async getUsedIngressPorts(): Promise<Set<number>> {
    const services = await docker.listServices();
    const ports = new Set<number>();
    for (const svc of services) {
      const endpoint = (svc as any).Endpoint;
      if (endpoint?.Ports) {
        for (const p of endpoint.Ports) {
          if (p.PublishedPort) ports.add(p.PublishedPort);
        }
      }
    }
    return ports;
  }

  /**
   * Auto-allocate free published ports for services that need external access.
   * Range: 30000-39999. Services with a domain should NOT use this.
   */
  async allocateIngressPorts(
    targetPorts: Array<{ target: number; protocol: string }>,
  ): Promise<Array<{ target: number; published: number; protocol: string }>> {
    if (targetPorts.length === 0) return [];
    const usedPorts = await this.getUsedIngressPorts();
    let nextPort = 30000;

    return targetPorts.map((p) => {
      while (usedPorts.has(nextPort) && nextPort <= 39999) {
        nextPort++;
      }
      if (nextPort > 39999) {
        throw new Error('No free ports available in range 30000-39999');
      }
      const published = nextPort++;
      return { target: p.target, published, protocol: p.protocol };
    });
  }

  /**
   * Copy data from one Docker volume to another using a temporary Alpine container.
   * Used when a service changes its volume source to preserve data.
   */
  async copyVolumeData(sourceVolume: string, targetVolume: string): Promise<void> {
    const container = await docker.createContainer({
      Image: 'alpine:latest',
      Cmd: ['sh', '-c', 'cp -a /source/. /target/ 2>/dev/null; true'],
      HostConfig: {
        Binds: [
          `${sourceVolume}:/source:ro`,
          `${targetVolume}:/target`,
        ],
      },
    });
    try {
      await container.start();
      await container.wait();
    } finally {
      await container.remove({ force: true }).catch(() => {});
    }
  }

  /**
   * Remove all data from a Docker volume by mounting it and deleting everything.
   */
  async cleanVolume(volumeName: string): Promise<void> {
    const container = await docker.createContainer({
      Image: 'alpine:latest',
      Cmd: ['sh', '-c', 'rm -rf /vol/* /vol/.[!.]* /vol/..?* 2>/dev/null; true'],
      HostConfig: {
        Binds: [`${volumeName}:/vol`],
      },
    });
    try {
      await container.start();
      await container.wait();
    } finally {
      await container.remove({ force: true }).catch(() => {});
    }
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

  async inspectContainer(containerId: string): Promise<any> {
    const container = docker.getContainer(containerId);
    return container.inspect();
  }

  /**
   * Get cumulative network rx/tx bytes for a running container.
   * Uses Docker stats API with stream=false (one-shot).
   */
  async getContainerNetworkBytes(containerId: string): Promise<{ containerId: string; rxBytes: number; txBytes: number } | null> {
    try {
      const container = docker.getContainer(containerId);
      const stats = await container.stats({ stream: false }) as any;

      let rxBytes = 0;
      let txBytes = 0;

      if (stats.networks) {
        for (const netStats of Object.values(stats.networks) as any[]) {
          rxBytes += netStats.rx_bytes ?? 0;
          txBytes += netStats.tx_bytes ?? 0;
        }
      }

      return { containerId, rxBytes, txBytes };
    } catch {
      return null;
    }
  }

  /**
   * Get detailed container stats (CPU, memory, network, disk I/O).
   * Uses Docker stats API with stream=false (one-shot).
   */
  async getContainerStats(containerId: string): Promise<ContainerStats | null> {
    try {
      const container = docker.getContainer(containerId);
      const stats = await container.stats({ stream: false }) as any;

      // CPU percent calculation
      const cpuDelta = (stats.cpu_stats?.cpu_usage?.total_usage ?? 0) - (stats.precpu_stats?.cpu_usage?.total_usage ?? 0);
      const systemDelta = (stats.cpu_stats?.system_cpu_usage ?? 0) - (stats.precpu_stats?.system_cpu_usage ?? 0);
      const numCpus = stats.cpu_stats?.online_cpus ?? stats.cpu_stats?.cpu_usage?.percpu_usage?.length ?? 1;
      const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

      // Memory
      const memoryUsageBytes = stats.memory_stats?.usage ?? 0;
      const memoryLimitBytes = stats.memory_stats?.limit ?? 1;
      const memoryPercent = (memoryUsageBytes / memoryLimitBytes) * 100;

      // Network I/O
      let networkRxBytes = 0;
      let networkTxBytes = 0;
      if (stats.networks) {
        for (const netStats of Object.values(stats.networks) as any[]) {
          networkRxBytes += netStats.rx_bytes ?? 0;
          networkTxBytes += netStats.tx_bytes ?? 0;
        }
      }

      // Block I/O
      let blockReadBytes = 0;
      let blockWriteBytes = 0;
      const ioStats = stats.blkio_stats?.io_service_bytes_recursive ?? [];
      for (const entry of ioStats) {
        if (entry.op === 'read' || entry.op === 'Read') blockReadBytes += entry.value ?? 0;
        if (entry.op === 'write' || entry.op === 'Write') blockWriteBytes += entry.value ?? 0;
      }

      return {
        cpuPercent: Math.round(cpuPercent * 100) / 100,
        memoryUsageBytes,
        memoryLimitBytes,
        memoryPercent: Math.round(memoryPercent * 100) / 100,
        networkRxBytes,
        networkTxBytes,
        blockReadBytes,
        blockWriteBytes,
        pids: stats.pids_stats?.current ?? 0,
      };
    } catch {
      return null;
    }
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

  async inspectNetwork(networkId: string): Promise<{ Name: string; Id: string; Driver: string; Scope: string }> {
    const network = docker.getNetwork(networkId);
    return network.inspect();
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
    env?: string[],
  ): Promise<{ stdout: string; exitCode: number }> {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Env: env,
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
    env?: string[],
  ): Promise<{ stream: Readable; exec: Dockerode.Exec }> {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: false,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Env: env,
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

    rawStream.on('end', () => {
      clearTimeout(timer);
      stdout.end();
      stderr.end();
    });
    rawStream.on('error', (err) => {
      clearTimeout(timer);
      stdout.destroy(err);
      stderr.destroy(err);
    });
    stdout.on('close', () => clearTimeout(timer));

    return { stream: stdout, exec };
  }

  // Execute command with stdin input (for database restore)
  async execCommandWithInput(
    containerId: string,
    cmd: string[],
    input: Readable,
    timeoutMs: number = 600_000,
    env?: string[],
  ): Promise<{ exitCode: number; stderr: string }> {
    const container = docker.getContainer(containerId);
    const exec = await container.exec({
      Cmd: cmd,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
      Env: env,
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

  /**
   * Run a shell command on all Swarm nodes via a global one-shot Docker service.
   * Uses chroot into the host filesystem to install packages, etc.
   * Returns once all node tasks have completed or timed out.
   */
  async runOnAllNodes(command: string, opts?: { timeoutMs?: number }): Promise<{
    success: boolean;
    results: Array<{ nodeId: string; status: string; error?: string }>;
  }> {
    const timeout = opts?.timeoutMs ?? 120_000;
    const serviceName = `fleet-node-cmd-${Date.now().toString(36)}`;

    // Create a global service with host root mounted, running the command via chroot
    const svc = await docker.createService({
      Name: serviceName,
      Labels: { 'fleet.internal': 'true', 'fleet.one-shot': 'true' },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'alpine:latest',
          // Mount host root filesystem and chroot into it to run commands
          Mounts: [{
            Type: 'bind' as const,
            Source: '/',
            Target: '/host',
            ReadOnly: false,
          }],
          Args: ['sh', '-c', `chroot /host sh -c '${command.replace(/'/g, "'\\''")}'`],
        },
        RestartPolicy: {
          Condition: 'none' as const,
          MaxAttempts: 0,
        },
        Resources: {
          Limits: { MemoryBytes: 512 * 1024 * 1024 },
        },
      },
      Mode: { Global: {} },
    } as any);

    const serviceId = svc.id;

    // Poll for completion
    const startTime = Date.now();
    const results: Array<{ nodeId: string; status: string; error?: string }> = [];

    try {
      while (Date.now() - startTime < timeout) {
        await new Promise((r) => setTimeout(r, 3000));

        const tasks = await docker.listTasks({ filters: { service: [serviceName] } });
        const allDone = tasks.length > 0 && tasks.every(
          (t: any) => t.Status?.State === 'complete' || t.Status?.State === 'failed' || t.Status?.State === 'rejected',
        );

        if (allDone) {
          for (const t of tasks) {
            results.push({
              nodeId: t.NodeID ?? 'unknown',
              status: t.Status?.State ?? 'unknown',
              error: t.Status?.State === 'failed' ? (t.Status?.Err ?? t.Status?.Message) : undefined,
            });
          }
          break;
        }
      }

      // If we timed out, collect whatever status we have
      if (results.length === 0) {
        const tasks = await docker.listTasks({ filters: { service: [serviceName] } });
        for (const t of tasks) {
          results.push({
            nodeId: t.NodeID ?? 'unknown',
            status: t.Status?.State ?? 'timeout',
            error: 'Timed out waiting for completion',
          });
        }
      }
    } finally {
      // Always clean up the one-shot service
      try {
        const service = docker.getService(serviceId);
        await service.remove();
      } catch { /* ignore cleanup failures */ }
    }

    return {
      success: results.every((r) => r.status === 'complete'),
      results,
    };
  }

  /**
   * Remove a Docker volume by name on ALL Swarm nodes.
   * Uses a global one-shot service with Docker socket mounted so it can call `docker volume rm`.
   * Silently ignores nodes where the volume doesn't exist.
   */
  async removeDockerVolumeOnAllNodes(volumeName: string): Promise<void> {
    const serviceName = `fleet-vol-cleanup-${Date.now().toString(36)}`;
    const svc = await docker.createService({
      Name: serviceName,
      Labels: { 'fleet.internal': 'true', 'fleet.one-shot': 'true' },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'docker:cli',
          Mounts: [{
            Type: 'bind' as const,
            Source: '/var/run/docker.sock',
            Target: '/var/run/docker.sock',
            ReadOnly: false,
          }],
          Args: ['sh', '-c', `docker volume rm ${volumeName} 2>/dev/null || true`],
        },
        RestartPolicy: { Condition: 'none' as const, MaxAttempts: 0 },
      },
      Mode: { Global: {} },
    } as any);

    // Wait for all tasks to complete
    const deadline = Date.now() + 60_000;
    const svcId = typeof svc.id === 'string' ? svc.id : (svc as any).ID;
    while (Date.now() < deadline) {
      const tasks = await docker.listTasks({ filters: { service: [serviceName] } });
      const allDone = tasks.length > 0 && tasks.every(
        (t: any) => t.Status?.State === 'complete' || t.Status?.State === 'failed' || t.Status?.State === 'rejected',
      );
      if (allDone) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }

    // Clean up
    try { await docker.getService(svcId).remove(); } catch { /* ignore */ }
  }

  /**
   * Run a shell command on the local host via a temporary container with chroot.
   * Used to execute host-level CLI tools (e.g. gluster) from within the API container.
   */
  async runOnLocalHost(command: string, opts?: { timeoutMs?: number }): Promise<{
    exitCode: number;
    stdout: string;
  }> {
    const timeout = opts?.timeoutMs ?? 60_000;
    const container = await docker.createContainer({
      Image: 'alpine:latest',
      Cmd: ['sh', '-c', `chroot /host sh -c '${command.replace(/'/g, "'\\''")}'`],
      HostConfig: {
        Binds: ['/:/host'],
      },
    });

    try {
      await container.start();

      // Attach to get stdout
      const logStream = await container.logs({ follow: true, stdout: true, stderr: true });
      let output = '';
      if (Buffer.isBuffer(logStream)) {
        output = logStream.toString();
      } else {
        const chunks: Buffer[] = [];
        const collectPromise = new Promise<void>((resolve) => {
          (logStream as NodeJS.ReadableStream).on('data', (chunk: Buffer) => chunks.push(chunk));
          (logStream as NodeJS.ReadableStream).on('end', resolve);
        });
        const timeoutPromise = new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Timed out')), timeout),
        );
        await Promise.race([collectPromise, timeoutPromise]);
        output = Buffer.concat(chunks).toString();
      }

      const result = await container.wait();
      return { exitCode: result.StatusCode, stdout: output };
    } finally {
      await container.remove({ force: true }).catch(() => {});
    }
  }

  /**
   * Get the current platform volume mode by inspecting the Traefik service mounts.
   * Returns 'distributed' if certs mount uses a GlusterFS/Ceph bind mount, otherwise 'local'.
   */
  async getPlatformVolumeMode(): Promise<'local' | 'distributed'> {
    try {
      const services = await docker.listServices({ filters: { name: ['fleet_traefik'] } });
      const svc = services.find((s: any) => s.Spec?.Name === 'fleet_traefik');
      if (!svc) return 'local';

      const mounts: any[] = (svc as any).Spec?.TaskTemplate?.ContainerSpec?.Mounts ?? [];
      const certMount = mounts.find((m: any) => m.Target === '/certs');
      if (!certMount) return 'local';

      // Distributed mode uses a bind mount to /mnt/fleet-platform-certs (host-level GlusterFS/Ceph mount)
      if (certMount.Type === 'bind' && certMount.Source === '/mnt/fleet-platform-certs') return 'distributed';

      return 'local';
    } catch {
      return 'local';
    }
  }

  /**
   * Run a privileged command on ALL Swarm nodes using Docker-in-Docker with nsenter.
   * This enters the host's mount/PID/network namespace, allowing host-level operations
   * like mounting filesystems and managing systemd services — things that regular
   * chroot-based runOnAllNodes cannot do.
   */
  async runOnAllNodesPrivileged(command: string, opts?: { timeoutMs?: number }): Promise<{
    success: boolean;
    results: Array<{ nodeId: string; status: string; error?: string }>;
  }> {
    const timeout = opts?.timeoutMs ?? 120_000;
    const serviceName = `fleet-priv-cmd-${Date.now().toString(36)}`;

    // Escape single quotes in command for shell nesting
    const escapedCmd = command.replace(/'/g, "'\\''");

    const svc = await docker.createService({
      Name: serviceName,
      Labels: { 'fleet.internal': 'true', 'fleet.one-shot': 'true' },
      TaskTemplate: {
        ContainerSpec: {
          Image: 'docker:cli',
          Mounts: [{
            Type: 'bind' as const,
            Source: '/var/run/docker.sock',
            Target: '/var/run/docker.sock',
            ReadOnly: false,
          }],
          Args: ['sh', '-c', `docker run --rm --privileged --pid=host alpine nsenter -t 1 -m -u -i -n -- sh -c '${escapedCmd}'`],
        },
        RestartPolicy: { Condition: 'none' as const, MaxAttempts: 0 },
        Resources: { Limits: { MemoryBytes: 512 * 1024 * 1024 } },
      },
      Mode: { Global: {} },
    } as any);

    const svcId = typeof svc.id === 'string' ? svc.id : (svc as any).ID;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      const tasks = await docker.listTasks({ filters: { service: [serviceName] } });
      const allDone = tasks.length > 0 && tasks.every(
        (t: any) => t.Status?.State === 'complete' || t.Status?.State === 'failed' || t.Status?.State === 'rejected',
      );
      if (allDone) {
        const results = tasks.map((t: any) => ({
          nodeId: t.NodeID,
          status: t.Status?.State,
          error: t.Status?.Err,
        }));
        const success = tasks.every((t: any) => t.Status?.State === 'complete');
        try { await docker.getService(svcId).remove(); } catch { /* ignore */ }
        return { success, results };
      }
      await new Promise((r) => setTimeout(r, 2_000));
    }

    // Timeout — clean up
    try { await docker.getService(svcId).remove(); } catch { /* ignore */ }
    return { success: false, results: [{ nodeId: 'unknown', status: 'timeout', error: 'Timed out waiting for tasks' }] };
  }

  /**
   * Switch platform service volumes (Traefik certs) between local and distributed storage.
   *
   * Approach: GlusterFS FUSE mounts require a persistent userspace process that Docker containers
   * cannot manage (the process dies when the container exits). Instead, we:
   * 1. Create the GlusterFS volume on the cluster (idempotent)
   * 2. Use nsenter + systemd to create a persistent host-level FUSE mount on all nodes
   * 3. Bind-mount the host path into Docker (no Docker volume driver needed)
   *
   * - distributed: Mounts GlusterFS at /mnt/fleet-platform-certs on all nodes via systemd, binds into Traefik
   * - local: Stops systemd mount, ensures /opt/fleet/certs on all nodes, restores original volume
   */
  async updatePlatformVolumeMounts(mode: 'distributed' | 'local'): Promise<{
    applied: boolean;
    message: string;
  }> {
    const MOUNT_PATH = '/mnt/fleet-platform-certs';

    // Find fleet_traefik service
    const services = await docker.listServices({ filters: { name: ['fleet_traefik'] } });
    const svc = services.find((s: any) => s.Spec?.Name === 'fleet_traefik') as any;
    if (!svc) {
      return { applied: false, message: 'fleet_traefik service not found' };
    }

    const spec = svc.Spec;
    const mounts: any[] = spec.TaskTemplate?.ContainerSpec?.Mounts ?? [];
    const certMountIdx = mounts.findIndex((m: any) => m.Target === '/certs');

    if (certMountIdx === -1) {
      return { applied: false, message: 'No /certs mount found on fleet_traefik' };
    }

    const currentMount = mounts[certMountIdx];
    const isCurrentlyDistributed = currentMount.Type === 'bind' && currentMount.Source === MOUNT_PATH;

    if (mode === 'distributed') {
      if (isCurrentlyDistributed) {
        return { applied: false, message: 'Platform volumes already using distributed storage' };
      }

      // Check if distributed storage is ready
      try {
        if (!storageManager.volumes.isReady()) {
          return { applied: false, message: 'Distributed storage not ready' };
        }
      } catch {
        return { applied: false, message: 'Storage manager not initialized' };
      }

      const provider = storageManager.config?.provider;

      // Create the GlusterFS volume on the cluster (idempotent)
      if (provider === 'glusterfs') {
        const config = storageManager.config!.config;
        const nodes = config.nodes as Array<{ hostname: string; ip: string; brickPath: string }>;
        const replicaCount = config.replicaCount ?? storageManager.config!.replicationFactor;

        if (nodes && nodes.length >= replicaCount) {
          const bricks = nodes
            .slice(0, replicaCount)
            .map((n: any) => `${n.ip}:${n.brickPath}/${PLATFORM_CERTS_VOLUME}`)
            .join(' ');
          const transport = config.transport ?? 'tcp';
          const gluster = '/usr/sbin/gluster';

          const createCmd = [
            `${gluster} volume info ${PLATFORM_CERTS_VOLUME} >/dev/null 2>&1`,
            `|| (${gluster} volume create ${PLATFORM_CERTS_VOLUME} replica ${replicaCount} transport ${transport} ${bricks} force`,
            `&& ${gluster} volume start ${PLATFORM_CERTS_VOLUME})`,
          ].join(' ');

          const result = await this.runOnLocalHost(createCmd, { timeoutMs: 30_000 });
          if (result.exitCode !== 0) {
            logger.warn({ exitCode: result.exitCode, stdout: result.stdout }, 'GlusterFS platform volume creation may have failed');
          } else {
            logger.info('GlusterFS platform certs volume created/verified');
          }
        }

        // Copy certs from local to GlusterFS before switching the mount
        // We mount GlusterFS temporarily, copy, then let the systemd service handle the persistent mount
        const firstNodeIp = (config.nodes as any[])?.[0]?.ip;
        if (firstNodeIp) {
          try {
            const copyResult = await this.runOnLocalHost(
              `mkdir -p ${MOUNT_PATH} && mount -t glusterfs ${firstNodeIp}:/${PLATFORM_CERTS_VOLUME} ${MOUNT_PATH} && ` +
              `cp -a /opt/fleet/certs/. ${MOUNT_PATH}/ 2>/dev/null; ` +
              `umount ${MOUNT_PATH} 2>/dev/null; true`,
              { timeoutMs: 30_000 },
            );
            if (copyResult.exitCode === 0) {
              logger.info('Copied certs from local to GlusterFS volume');
            }
          } catch (err) {
            logger.warn({ err }, 'Failed to copy certs to GlusterFS — Traefik will re-issue certificates');
          }
        }

        // Create systemd mount service and mount GlusterFS on ALL nodes via nsenter
        // nsenter enters the host's mount namespace so the FUSE process is managed by
        // the host's systemd, not a container (which would kill it on exit)
        const mountCmd = [
          `umount -l ${MOUNT_PATH} 2>/dev/null || true`,
          `mkdir -p ${MOUNT_PATH}`,
          // Write systemd service unit
          `cat > /etc/systemd/system/fleet-gluster-certs.service << 'SYSTEMD_EOF'`,
          `[Unit]`,
          `Description=GlusterFS Platform Certs Mount`,
          `After=network-online.target glusterd.service`,
          `Wants=network-online.target`,
          ``,
          `[Service]`,
          `Type=forking`,
          `ExecStart=/bin/mount -t glusterfs ${firstNodeIp}:/${PLATFORM_CERTS_VOLUME} ${MOUNT_PATH}`,
          `ExecStop=/bin/umount ${MOUNT_PATH}`,
          `RemainAfterExit=yes`,
          `Restart=on-failure`,
          `RestartSec=10`,
          ``,
          `[Install]`,
          `WantedBy=multi-user.target`,
          `SYSTEMD_EOF`,
          `systemctl daemon-reload`,
          `systemctl enable fleet-gluster-certs.service`,
          `systemctl start fleet-gluster-certs.service`,
          `sleep 2`,
          `ls ${MOUNT_PATH}/`,
        ].join('\n');

        const mountResult = await this.runOnAllNodesPrivileged(mountCmd, { timeoutMs: 120_000 });
        if (!mountResult.success) {
          logger.warn({ results: mountResult.results }, 'GlusterFS mount failed on some nodes');
          return { applied: false, message: 'Failed to mount GlusterFS on all nodes' };
        }
        logger.info('GlusterFS platform certs mounted on all nodes via systemd');
      } else if (provider === 'ceph') {
        // Ceph uses CephFS (distributed filesystem) for shared platform volumes.
        // CephFS is a kernel mount (not FUSE), so it's more stable than GlusterFS.
        const config = storageManager.config!.config;
        const monitors = config.monitors as string;
        const user = config.user ?? 'admin';
        const keyring = config.keyring ?? '/etc/ceph/ceph.client.admin.keyring';
        const cephfsPath = `/fleet-platform-certs`;

        if (!monitors) {
          return { applied: false, message: 'Ceph monitors not configured' };
        }

        // Ensure CephFS directory exists using ceph-fuse temporarily on local host
        try {
          const mkdirCmd = `ceph fs subvolumegroup create cephfs fleet 2>/dev/null || true; ` +
            `mkdir -p /tmp/cephfs-tmp && mount -t ceph ${monitors}:/ /tmp/cephfs-tmp -o name=${user},secretfile=${keyring} && ` +
            `mkdir -p /tmp/cephfs-tmp${cephfsPath} && ` +
            `cp -a /opt/fleet/certs/. /tmp/cephfs-tmp${cephfsPath}/ 2>/dev/null; ` +
            `umount /tmp/cephfs-tmp 2>/dev/null; rmdir /tmp/cephfs-tmp 2>/dev/null; true`;
          await this.runOnLocalHost(mkdirCmd, { timeoutMs: 30_000 });
          logger.info('CephFS platform certs directory created and certs copied');
        } catch (err) {
          logger.warn({ err }, 'Failed to prepare CephFS directory — Traefik will re-issue certificates');
        }

        // Create systemd mount service on ALL nodes via nsenter
        // CephFS is a kernel mount (Type=oneshot, not forking like GlusterFS FUSE)
        const mountCmd = [
          `umount -l ${MOUNT_PATH} 2>/dev/null || true`,
          `mkdir -p ${MOUNT_PATH}`,
          `cat > /etc/systemd/system/fleet-platform-certs.service << 'SYSTEMD_EOF'`,
          `[Unit]`,
          `Description=CephFS Platform Certs Mount`,
          `After=network-online.target`,
          `Wants=network-online.target`,
          ``,
          `[Service]`,
          `Type=oneshot`,
          `ExecStart=/bin/mount -t ceph ${monitors}:${cephfsPath} ${MOUNT_PATH} -o name=${user},secretfile=${keyring},_netdev`,
          `ExecStop=/bin/umount ${MOUNT_PATH}`,
          `RemainAfterExit=yes`,
          ``,
          `[Install]`,
          `WantedBy=multi-user.target`,
          `SYSTEMD_EOF`,
          `systemctl daemon-reload`,
          `systemctl enable fleet-platform-certs.service`,
          `systemctl start fleet-platform-certs.service`,
          `sleep 1`,
          `ls ${MOUNT_PATH}/`,
        ].join('\n');

        const mountResult = await this.runOnAllNodesPrivileged(mountCmd, { timeoutMs: 120_000 });
        if (!mountResult.success) {
          logger.warn({ results: mountResult.results }, 'CephFS mount failed on some nodes');
          return { applied: false, message: 'Failed to mount CephFS on all nodes' };
        }
        logger.info('CephFS platform certs mounted on all nodes via systemd');
      }

      // Update Traefik mount to bind from host distributed mount path
      mounts[certMountIdx] = {
        Source: MOUNT_PATH,
        Target: '/certs',
        Type: 'bind' as const,
        ReadOnly: false,
      };
    } else {
      // mode === 'local'
      if (!isCurrentlyDistributed) {
        await this.runOnAllNodes('mkdir -p /opt/fleet/certs', { timeoutMs: 30_000 }).catch(() => {});
        return { applied: true, message: 'Platform volumes already local, ensured directories on all nodes' };
      }

      // Copy certs from distributed mount back to local directory
      try {
        await this.runOnAllNodes(
          `cp -a ${MOUNT_PATH}/. /opt/fleet/certs/ 2>/dev/null || true`,
          { timeoutMs: 30_000 },
        );
        logger.info('Copied certs from distributed mount to local directory');
      } catch (err) {
        logger.warn({ err }, 'Failed to copy certs from distributed mount — Traefik will re-issue certificates');
      }

      // Stop and disable the systemd mount service on all nodes (handle both GlusterFS and Ceph service names)
      try {
        await this.runOnAllNodesPrivileged(
          'for svc in fleet-gluster-certs fleet-platform-certs; do ' +
          '  systemctl stop $svc.service 2>/dev/null || true; ' +
          '  systemctl disable $svc.service 2>/dev/null || true; ' +
          '  rm -f /etc/systemd/system/$svc.service; ' +
          'done; ' +
          'systemctl daemon-reload',
          { timeoutMs: 60_000 },
        );
        logger.info('Disabled platform certs mount on all nodes');
      } catch (err) {
        logger.warn({ err }, 'Failed to disable systemd mount on some nodes');
      }

      // Ensure /opt/fleet/certs exists on all nodes
      await this.runOnAllNodes('mkdir -p /opt/fleet/certs', { timeoutMs: 30_000 });

      // Restore original bind-mount volume
      mounts[certMountIdx] = {
        Source: 'fleet_fleet_certs',
        Target: '/certs',
        Type: 'volume' as const,
        ReadOnly: false,
      };
    }

    // Apply the updated spec to the service
    spec.TaskTemplate.ContainerSpec.Mounts = mounts;
    const dockerSvc = docker.getService(svc.ID);
    await dockerSvc.update({
      ...spec,
      version: svc.Version?.Index,
      TaskTemplate: {
        ...spec.TaskTemplate,
        ForceUpdate: ((spec.TaskTemplate as any).ForceUpdate ?? 0) + 1,
      },
    } as any);

    logger.info({ mode }, 'Platform volume mounts updated for fleet_traefik');
    return {
      applied: true,
      message: mode === 'distributed'
        ? 'Platform volumes switched to distributed storage — Traefik will redeploy on all manager nodes'
        : 'Platform volumes switched to local storage — ensured directories on all nodes',
    };
  }

  /**
   * Ensure the base service volume mount exists on all Swarm nodes.
   *
   * For GlusterFS: Creates the `fleet-service-data` GlusterFS volume (idempotent),
   * then creates a systemd service on every node to FUSE-mount it at /mnt/fleet-volumes.
   *
   * For Ceph: Creates a CephFS subvolume and kernel-mounts it on every node.
   *
   * Must be called after storage cluster setup (POST /cluster) and verified at startup.
   */
  async ensureServiceVolumeMount(): Promise<{
    applied: boolean;
    message: string;
  }> {
    const provider = storageManager.config?.provider;
    if (!provider || provider === 'local') {
      return { applied: false, message: 'No distributed storage configured' };
    }

    const MOUNT_BASE = '/mnt/fleet-volumes';

    if (provider === 'glusterfs') {
      const config = storageManager.config!.config;
      const nodes = config.nodes as Array<{ hostname: string; ip: string; brickPath: string }>;
      const replicaCount = config.replicaCount ?? storageManager.config!.replicationFactor;
      const transport = config.transport ?? 'tcp';
      const volumeName = 'fleet-service-data';

      if (!nodes || nodes.length < replicaCount) {
        return { applied: false, message: `Need at least ${replicaCount} storage nodes for GlusterFS` };
      }

      const bricks = nodes
        .slice(0, replicaCount)
        .map((n: any) => `${n.ip}:${n.brickPath}/${volumeName}`)
        .join(' ');
      const gluster = '/usr/sbin/gluster';
      const firstNodeIp = nodes[0]!.ip;

      // Create the GlusterFS volume on the cluster (idempotent)
      const createCmd = [
        `${gluster} volume info ${volumeName} >/dev/null 2>&1`,
        `|| (${gluster} volume create ${volumeName} replica ${replicaCount} transport ${transport} ${bricks} force`,
        `&& ${gluster} volume start ${volumeName})`,
      ].join(' ');

      const createResult = await this.runOnLocalHost(createCmd, { timeoutMs: 30_000 });
      if (createResult.exitCode !== 0) {
        logger.warn({ exitCode: createResult.exitCode, stdout: createResult.stdout }, 'GlusterFS service volume creation may have failed');
      } else {
        logger.info('GlusterFS service data volume created/verified');
      }

      // Create systemd mount service on ALL nodes
      const mountCmd = [
        `umount -l ${MOUNT_BASE} 2>/dev/null || true`,
        `mkdir -p ${MOUNT_BASE}`,
        `cat > /etc/systemd/system/fleet-gluster-volumes.service << 'SYSTEMD_EOF'`,
        `[Unit]`,
        `Description=GlusterFS Service Volumes Mount`,
        `After=network-online.target glusterd.service`,
        `Wants=network-online.target`,
        ``,
        `[Service]`,
        `Type=forking`,
        `ExecStart=/bin/mount -t glusterfs ${firstNodeIp}:/${volumeName} ${MOUNT_BASE}`,
        `ExecStop=/bin/umount ${MOUNT_BASE}`,
        `RemainAfterExit=yes`,
        `Restart=on-failure`,
        `RestartSec=10`,
        ``,
        `[Install]`,
        `WantedBy=multi-user.target`,
        `SYSTEMD_EOF`,
        `systemctl daemon-reload`,
        `systemctl enable fleet-gluster-volumes.service`,
        `systemctl start fleet-gluster-volumes.service`,
        `sleep 2`,
        `mountpoint -q ${MOUNT_BASE} && echo "MOUNT_OK" || echo "MOUNT_FAILED"`,
      ].join('\n');

      const mountResult = await this.runOnAllNodesPrivileged(mountCmd, { timeoutMs: 120_000 });
      if (!mountResult.success) {
        logger.warn({ results: mountResult.results }, 'GlusterFS service volume mount failed on some nodes');
        return { applied: false, message: 'Failed to mount GlusterFS service volume on all nodes' };
      }

      logger.info('GlusterFS service data volume mounted on all Swarm nodes');
      return { applied: true, message: 'GlusterFS service volume mounted on all nodes via systemd' };
    }

    if (provider === 'ceph') {
      const config = storageManager.config!.config;
      const monitors = config.monitors as string;
      const user = config.user ?? 'admin';
      const keyring = config.keyring ?? '/etc/ceph/ceph.client.admin.keyring';

      if (!monitors) {
        return { applied: false, message: 'Ceph monitors not configured' };
      }

      // CephFS kernel mount for service volumes
      const cephfsPath = '/fleet-service-data';

      // Ensure the CephFS directory exists
      try {
        const mkdirCmd = `mkdir -p /tmp/cephfs-tmp && ` +
          `mount -t ceph ${monitors}:/ /tmp/cephfs-tmp -o name=${user},secretfile=${keyring} && ` +
          `mkdir -p /tmp/cephfs-tmp${cephfsPath} && ` +
          `umount /tmp/cephfs-tmp 2>/dev/null; rmdir /tmp/cephfs-tmp 2>/dev/null; true`;
        await this.runOnLocalHost(mkdirCmd, { timeoutMs: 30_000 });
      } catch (err) {
        logger.warn({ err }, 'Failed to prepare CephFS service volume directory');
      }

      // Create systemd mount service on ALL nodes (CephFS uses kernel mount, not FUSE)
      const mountCmd = [
        `umount -l ${MOUNT_BASE} 2>/dev/null || true`,
        `mkdir -p ${MOUNT_BASE}`,
        `cat > /etc/systemd/system/fleet-ceph-volumes.service << 'SYSTEMD_EOF'`,
        `[Unit]`,
        `Description=CephFS Service Volumes Mount`,
        `After=network-online.target`,
        `Wants=network-online.target`,
        ``,
        `[Service]`,
        `Type=oneshot`,
        `ExecStart=/bin/mount -t ceph ${monitors}:${cephfsPath} ${MOUNT_BASE} -o name=${user},secretfile=${keyring},_netdev`,
        `ExecStop=/bin/umount ${MOUNT_BASE}`,
        `RemainAfterExit=yes`,
        ``,
        `[Install]`,
        `WantedBy=multi-user.target`,
        `SYSTEMD_EOF`,
        `systemctl daemon-reload`,
        `systemctl enable fleet-ceph-volumes.service`,
        `systemctl start fleet-ceph-volumes.service`,
        `sleep 1`,
        `mountpoint -q ${MOUNT_BASE} && echo "MOUNT_OK" || echo "MOUNT_FAILED"`,
      ].join('\n');

      const mountResult = await this.runOnAllNodesPrivileged(mountCmd, { timeoutMs: 120_000 });
      if (!mountResult.success) {
        logger.warn({ results: mountResult.results }, 'CephFS service volume mount failed on some nodes');
        return { applied: false, message: 'Failed to mount CephFS service volume on all nodes' };
      }

      logger.info('CephFS service data volume mounted on all Swarm nodes');
      return { applied: true, message: 'CephFS service volume mounted on all nodes via systemd' };
    }

    return { applied: false, message: `Unsupported storage provider: ${provider}` };
  }
}

function parseDelay(delay: string): number {
  const match = delay.match(/^(\d+(?:\.\d+)?)(ns|us|ms|s|m|h)?$/);
  if (!match) return 10_000_000_000; // default 10s in nanoseconds

  const value = parseFloat(match[1]!);
  const unit = match[2] ?? 's';

  const multipliers: Record<string, number> = {
    ns: 1,
    us: 1_000,
    ms: 1_000_000,
    s: 1_000_000_000,
    m: 60_000_000_000,
    h: 3_600_000_000_000,
  };

  return Math.round(value * (multipliers[unit] ?? 1_000_000_000));
}

export const dockerService = new DockerService();
