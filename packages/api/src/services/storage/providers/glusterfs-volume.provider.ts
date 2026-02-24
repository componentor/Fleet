import Dockerode from 'dockerode';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../logger.js';
import type {
  VolumeStorageProvider,
  VolumeInfo,
  VolumeResult,
  StorageHealth,
  StorageNodeHealth,
  StoragePrerequisite,
} from '../storage-provider.js';

const execFile = promisify(execFileCb);
const docker = new Dockerode({ socketPath: '/var/run/docker.sock' });

/** Validate volume name to prevent injection. */
function validateVolumeName(name: string): void {
  if (!name || name.length > 128 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name.includes('..')) {
    throw new Error('Invalid volume name');
  }
}

/** Validate an IP address (IPv4 only). */
function validateIp(ip: string): void {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    throw new Error(`Invalid IP address: ${ip}`);
  }
  const parts = ip.split('.').map(Number);
  if (parts.some((p) => p < 0 || p > 255)) {
    throw new Error(`Invalid IP address: ${ip}`);
  }
}

/** Validate a brick path — must be absolute, no special chars. */
function validateBrickPath(path: string): void {
  if (!path || !path.startsWith('/') || /[;&|`$"'\\]/.test(path) || path.includes('..')) {
    throw new Error(`Invalid brick path: ${path}`);
  }
}

export interface GlusterFSConfig {
  /** Storage nodes: { hostname, ip, brickPath }[] */
  nodes: Array<{ hostname: string; ip: string; brickPath: string }>;
  /** Replication factor (default 3) */
  replicaCount?: number;
  /** Transport type: tcp or rdma (default tcp) */
  transport?: string;
}

/**
 * GlusterFS Volume Provider — manages replicated volumes across a GlusterFS cluster.
 *
 * Architecture: A single GlusterFS volume (fleet-service-data) is FUSE-mounted at
 * /mnt/fleet-volumes on every Swarm node via a systemd service. Individual service
 * "volumes" are subdirectories under this mount, automatically replicated by GlusterFS.
 *
 * Docker cannot FUSE-mount GlusterFS directly ("no such device"), so Docker services
 * use bind mounts from the host-level FUSE mount managed by systemd.
 *
 * The base volume creation and systemd mount setup is handled by
 * DockerService.ensureServiceVolumeMount(), called during storage cluster setup.
 */
export class GlusterFSVolumeProvider implements VolumeStorageProvider {
  readonly name = 'glusterfs';
  private config: GlusterFSConfig;
  private replicaCount: number;

  /** Base mount path where the GlusterFS service volume is mounted on each host. */
  static readonly HOST_MOUNT_BASE = '/mnt/fleet-volumes';

  /** Name of the single GlusterFS volume used for all service data. */
  static readonly SERVICE_VOLUME_NAME = 'fleet-service-data';

  constructor(config: Record<string, any>) {
    this.config = {
      nodes: config.nodes ?? [],
      replicaCount: config.replicaCount ?? 3,
      transport: config.transport ?? 'tcp',
    };
    this.replicaCount = this.config.replicaCount ?? 3;
  }

  async initialize(): Promise<void> {
    // Validate configured peers
    for (const node of this.config.nodes) {
      validateIp(node.ip);
      validateBrickPath(node.brickPath);
    }

    // Verify gluster CLI is available (may not be if running in Docker container)
    let hasGlusterCli = false;
    try {
      await execFile('gluster', ['--version']);
      hasGlusterCli = true;
    } catch {
      logger.info('GlusterFS CLI not available locally — expected when running in Docker container');
    }

    // Probe peers if gluster CLI is available
    if (hasGlusterCli) {
      for (const node of this.config.nodes) {
        try {
          await execFile('gluster', ['peer', 'probe', node.ip]);
          logger.info({ ip: node.ip, hostname: node.hostname }, 'GlusterFS peer probed');
        } catch (err) {
          logger.debug({ err, ip: node.ip }, 'GlusterFS peer probe skipped');
        }
      }
    }
  }

  /**
   * Create a service volume as a subdirectory under the base GlusterFS mount.
   * GlusterFS automatically replicates the directory to all nodes.
   */
  async createVolume(name: string, _sizeGb: number, _nodeId?: string): Promise<VolumeResult> {
    validateVolumeName(name);

    const hostPath = this.getHostMountPath(name);

    // Create subdirectory via temporary Docker container that bind-mounts the
    // host's GlusterFS mount point. Creating on one node replicates to all via GlusterFS.
    await this.runOnHostMount(['mkdir', '-p', `/vol/${name}`]);
    logger.info({ name, hostPath }, 'GlusterFS service volume subdirectory created');

    return {
      name,
      path: hostPath,
      driver: 'local',
      driverOptions: {},
    };
  }

  /**
   * Ensure the volume subdirectory exists on the GlusterFS mount.
   * Idempotent — safe to call on every deploy.
   */
  async ensureVolume(name: string): Promise<void> {
    validateVolumeName(name);
    await this.runOnHostMount(['mkdir', '-p', `/vol/${name}`]);
  }

  /**
   * Delete a service volume subdirectory.
   */
  async deleteVolume(name: string): Promise<void> {
    validateVolumeName(name);

    await this.runOnHostMount(['rm', '-rf', `/vol/${name}`]);
    logger.info({ name }, 'GlusterFS service volume subdirectory deleted');
  }

  async resizeVolume(name: string, _newSizeGb: number): Promise<void> {
    validateVolumeName(name);
    // GlusterFS volumes share the underlying brick space. Individual subdirectory
    // quotas could be set via `gluster volume quota` but are not implemented yet.
    logger.debug({ name }, 'GlusterFS volume resize is a no-op — brick space is shared');
  }

  /**
   * List service volume subdirectories under the base mount.
   */
  async listVolumes(): Promise<VolumeInfo[]> {
    try {
      const output = await this.runOnHostMount(
        ['sh', '-c', 'for d in /vol/*/; do [ -d "$d" ] && basename "$d"; done'],
      );
      const names = output.trim().split('\n').filter(Boolean);

      const volumes: VolumeInfo[] = [];
      for (const name of names) {
        // Skip the lost+found directory and hidden dirs
        if (name === 'lost+found' || name.startsWith('.')) continue;
        try {
          const info = await this.getVolumeInfo(name);
          volumes.push(info);
        } catch {
          volumes.push({
            name,
            path: this.getHostMountPath(name),
            sizeGb: 0,
            usedGb: 0,
            availableGb: 0,
            status: 'error',
          });
        }
      }
      return volumes;
    } catch {
      return [];
    }
  }

  /**
   * Get info about a service volume subdirectory.
   */
  async getVolumeInfo(name: string): Promise<VolumeInfo> {
    validateVolumeName(name);

    // Get directory size via temp container
    let usedGb = 0;
    let sizeGb = 0;
    let availableGb = 0;

    try {
      const output = await this.runOnHostMount(
        ['sh', '-c', `du -sk /vol/${name} 2>/dev/null | awk '{print $1}'; df -k /vol/${name} 2>/dev/null | tail -1 | awk '{print $2, $3, $4}'`],
      );
      const lines = output.trim().split('\n');
      if (lines[0]) {
        usedGb = Math.round(parseInt(lines[0], 10) / (1024 * 1024) * 100) / 100;
      }
      if (lines[1]) {
        const [total, used, avail] = lines[1].split(/\s+/).map(Number);
        if (total) sizeGb = Math.round(total / (1024 * 1024) * 100) / 100;
        if (avail) availableGb = Math.round(avail / (1024 * 1024) * 100) / 100;
        // If du didn't work, fall back to df used
        if (usedGb === 0 && used) usedGb = Math.round(used / (1024 * 1024) * 100) / 100;
      }
    } catch {
      // Stats not available
    }

    return {
      name,
      path: this.getHostMountPath(name),
      sizeGb,
      usedGb,
      availableGb,
      replicaCount: this.replicaCount,
      status: 'ready',
    };
  }

  getDockerVolumeDriver(): string {
    return 'local';
  }

  getDockerVolumeOptions(_name: string): Record<string, string> {
    // Docker's local volume driver CANNOT FUSE-mount GlusterFS ("no such device").
    // All service volumes use bind mounts via getHostMountPath() instead.
    return {};
  }

  /**
   * GlusterFS requires host-level FUSE mounts managed by systemd.
   * Service volumes are subdirectories under /mnt/fleet-volumes/<name>.
   * The base GlusterFS volume is mounted at /mnt/fleet-volumes via a systemd service.
   */
  getHostMountPath(name: string): string {
    return `${GlusterFSVolumeProvider.HOST_MOUNT_BASE}/${name}`;
  }

  isReady(): boolean {
    return this.config.nodes.length > 0;
  }

  getPrerequisites(): StoragePrerequisite[] {
    return [
      {
        package: 'fuse',
        description: 'FUSE kernel module (required for GlusterFS volume mounts)',
        checkCommand: 'test -e /dev/fuse || lsmod | grep -q fuse',
        installCommand: 'modprobe fuse && echo fuse > /etc/modules-load.d/fuse.conf',
      },
      {
        package: 'glusterfs-server',
        description: 'GlusterFS server daemon',
        checkCommand: 'which glusterd',
        installCommand: 'apt-get install -y glusterfs-server && systemctl enable --now glusterd',
      },
      {
        package: 'glusterfs-client',
        description: 'GlusterFS FUSE client (required for Docker volume mounts)',
        checkCommand: 'which glusterfs',
        installCommand: 'apt-get install -y glusterfs-client',
      },
    ];
  }

  async getHealth(): Promise<StorageHealth> {
    const nodeHealths: StorageNodeHealth[] = [];
    let overallStatus: StorageHealth['status'] = 'healthy';

    // Check peer status
    try {
      const { stdout } = await execFile('gluster', ['peer', 'status']);
      const peerBlocks = stdout.split(/Hostname:/g).slice(1);

      for (const block of peerBlocks) {
        const hostnameMatch = block.match(/^\s*(.+)/);
        const stateMatch = block.match(/State:\s*Peer in Cluster\s*\((\w+)\)/);

        const hostname = hostnameMatch?.[1]?.trim() ?? 'unknown';
        const connected = stateMatch?.[1]?.toLowerCase() === 'connected';

        nodeHealths.push({
          hostname,
          ipAddress: hostname,
          status: connected ? 'healthy' : 'error',
          message: connected ? 'Connected' : 'Disconnected',
        });

        if (!connected) overallStatus = 'degraded';
      }
    } catch (err) {
      // GlusterFS CLI not available in this container — expected in containerized deployments
      const msg = String(err);
      if (msg.includes('ENOENT')) {
        return {
          status: 'healthy',
          provider: 'glusterfs',
          message: 'GlusterFS CLI not available locally — peer health is managed via SSH on storage nodes',
          nodes: this.config.nodes.map((n) => ({
            hostname: n.hostname,
            ipAddress: n.ip,
            status: 'healthy' as const,
            message: 'Health check deferred to node agent',
          })),
          replicationFactor: this.replicaCount,
          activeReplicas: this.config.nodes.length,
        };
      }
      return {
        status: 'error',
        provider: 'glusterfs',
        message: `Failed to check peer status: ${err}`,
      };
    }

    // Check volume heal status
    try {
      const { stdout: volList } = await execFile('gluster', ['volume', 'list']);
      const volumes = volList.trim().split('\n').filter(Boolean);

      for (const vol of volumes) {
        try {
          const { stdout: healInfo } = await execFile('gluster', ['volume', 'heal', vol, 'info', 'summary']);
          if (healInfo.includes('Number of entries:') && !healInfo.includes('Number of entries: 0')) {
            overallStatus = 'degraded';
          }
        } catch {
          // Heal info might not be available for non-replicated volumes
        }
      }
    } catch {
      // Volume list failed
    }

    return {
      status: overallStatus,
      provider: 'glusterfs',
      nodes: nodeHealths,
      replicationFactor: this.replicaCount,
      activeReplicas: nodeHealths.filter((n) => n.status === 'healthy').length,
      message: overallStatus === 'healthy' ? 'All nodes connected, no healing needed' : 'Cluster degraded',
    };
  }

  // ── Cluster Management ────────────────────────────────────────────────

  /** Add a new peer to the cluster. */
  async addPeer(ip: string): Promise<void> {
    validateIp(ip);
    await execFile('gluster', ['peer', 'probe', ip]);
  }

  /** Remove a peer from the cluster (must drain first). */
  async removePeer(ip: string): Promise<void> {
    validateIp(ip);
    await execFile('gluster', ['peer', 'detach', ip, 'force']);
  }

  /** Add a brick to an existing volume for expansion. */
  async addBrick(volumeName: string, ip: string, brickPath: string): Promise<void> {
    validateVolumeName(volumeName);
    validateIp(ip);
    validateBrickPath(brickPath);
    await execFile('gluster', [
      'volume', 'add-brick', volumeName,
      `${ip}:${brickPath}/${volumeName}`,
      'force',
    ]);
  }

  /** Trigger rebalance after adding bricks. */
  async rebalance(volumeName: string): Promise<void> {
    validateVolumeName(volumeName);
    await execFile('gluster', ['volume', 'rebalance', volumeName, 'start']);
  }

  /** Trigger self-heal on a volume. */
  async triggerHeal(volumeName: string): Promise<void> {
    validateVolumeName(volumeName);
    await execFile('gluster', ['volume', 'heal', volumeName, 'full']);
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Run a command inside a temporary container that has the host's GlusterFS
   * base mount (HOST_MOUNT_BASE) bind-mounted at /vol.
   *
   * Since the API container doesn't have the FUSE mount, we use Docker to
   * access the host's mount namespace. Creating/deleting files on the GlusterFS
   * mount replicates automatically to all nodes.
   */
  private async runOnHostMount(cmd: string[]): Promise<string> {
    const container = await docker.createContainer({
      Image: 'alpine:latest',
      Cmd: cmd,
      HostConfig: {
        Binds: [`${GlusterFSVolumeProvider.HOST_MOUNT_BASE}:/vol`],
      },
    });

    try {
      await container.start();
      const logStream = await container.logs({ follow: true, stdout: true, stderr: true });
      let output = '';
      if (Buffer.isBuffer(logStream)) {
        output = logStream.toString();
      } else {
        const chunks: Buffer[] = [];
        await new Promise<void>((resolve) => {
          (logStream as NodeJS.ReadableStream).on('data', (chunk: Buffer) => chunks.push(chunk));
          (logStream as NodeJS.ReadableStream).on('end', resolve);
        });
        output = Buffer.concat(chunks).toString();
      }
      const result = await container.wait();
      if (result.StatusCode !== 0) {
        throw new Error(`Command failed (exit ${result.StatusCode}): ${output}`);
      }
      // Strip Docker stream header bytes (8-byte prefix per frame)
      return stripDockerStreamHeaders(output);
    } finally {
      await container.remove({ force: true }).catch(() => {});
    }
  }
}

/** Strip Docker stream multiplexing header bytes from container log output. */
function stripDockerStreamHeaders(raw: string): string {
  // Docker stream protocol: each frame has an 8-byte header (stream type + size)
  // In text mode the headers may appear as garbled characters
  // Try to extract clean lines by removing non-printable characters
  return raw.replace(/[\x00-\x08\x0e-\x1f]/g, '').trim();
}
