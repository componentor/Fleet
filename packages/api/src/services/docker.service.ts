import Dockerode from 'dockerode';

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
}

export interface ServiceTaskInfo {
  id: string;
  nodeId: string;
  status: string;
  desiredState: string;
  message: string;
  containerStatus?: {
    containerId: string;
    pid: number;
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

    const serviceSpec: Dockerode.CreateServiceOptions = {
      Name: opts.name,
      Labels: opts.labels,
      TaskTemplate: {
        ContainerSpec: {
          Image: opts.image,
          Env: envArray,
          Mounts: opts.volumes.map((v) => ({
            Source: v.source,
            Target: v.target,
            Type: 'volume' as const,
            ReadOnly: v.readonly ?? false,
          })),
          HealthCheck: opts.healthCheck
            ? {
                Test: ['CMD-SHELL', opts.healthCheck.cmd],
                Interval: opts.healthCheck.interval * 1_000_000_000,
                Timeout: opts.healthCheck.timeout * 1_000_000_000,
                Retries: opts.healthCheck.retries,
              }
            : undefined,
          // Security hardening
          ReadOnly: true,
          User: '1000',
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
          Condition: 'on-failure',
          MaxAttempts: 3,
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

    await service.update({ version, ...spec });
  }

  async removeService(dockerServiceId: string): Promise<void> {
    const service = docker.getService(dockerServiceId);
    await service.remove();
  }

  async inspectService(dockerServiceId: string) {
    const service = docker.getService(dockerServiceId);
    return service.inspect();
  }

  async listServices(filters?: Record<string, string[]>) {
    return docker.listServices({ filters });
  }

  async getServiceLogs(
    dockerServiceId: string,
    opts: { tail?: number; since?: number; follow?: boolean } = {},
  ): Promise<NodeJS.ReadableStream> {
    const service = docker.getService(dockerServiceId);
    return service.logs({
      stdout: true,
      stderr: true,
      tail: opts.tail ?? 100,
      since: opts.since ?? 0,
      follow: opts.follow ?? false,
      timestamps: true,
    }) as Promise<NodeJS.ReadableStream>;
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
      containerStatus: t.Status.ContainerStatus
        ? {
            containerId: t.Status.ContainerStatus.ContainerID,
            pid: t.Status.ContainerStatus.PID,
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
