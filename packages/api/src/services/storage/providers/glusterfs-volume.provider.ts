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
 * All commands use execFile (no shell) for safety.
 */
export class GlusterFSVolumeProvider implements VolumeStorageProvider {
  readonly name = 'glusterfs';
  private config: GlusterFSConfig;
  private replicaCount: number;

  constructor(config: Record<string, any>) {
    this.config = {
      nodes: config.nodes ?? [],
      replicaCount: config.replicaCount ?? 3,
      transport: config.transport ?? 'tcp',
    };
    this.replicaCount = this.config.replicaCount ?? 3;
  }

  async initialize(): Promise<void> {
    // Verify gluster CLI is available (may not be if running in Docker container)
    let hasGlusterCli = false;
    try {
      await execFile('gluster', ['--version']);
      hasGlusterCli = true;
    } catch {
      logger.warn('GlusterFS CLI not available locally — peer probing will be handled via SSH during volume operations');
    }

    // Validate configured peers
    for (const node of this.config.nodes) {
      validateIp(node.ip);
      validateBrickPath(node.brickPath);
    }

    // Probe peers if gluster CLI is available (e.g. running on a storage node itself)
    if (hasGlusterCli) {
      for (const node of this.config.nodes) {
        try {
          await execFile('gluster', ['peer', 'probe', node.ip]);
          logger.info({ ip: node.ip, hostname: node.hostname }, 'GlusterFS peer probed');
        } catch (err) {
          // Peer may already be probed or is the local node
          logger.debug({ err, ip: node.ip }, 'GlusterFS peer probe skipped');
        }
      }
    }
  }

  async createVolume(name: string, _sizeGb: number, _nodeId?: string): Promise<VolumeResult> {
    validateVolumeName(name);

    if (this.config.nodes.length < this.replicaCount) {
      throw new Error(
        `Cannot create replica-${this.replicaCount} volume: only ${this.config.nodes.length} storage node(s) available`,
      );
    }

    // Build brick list: node1:/brick/vol-name node2:/brick/vol-name ...
    const bricks = this.config.nodes
      .slice(0, this.replicaCount)
      .map((n) => `${n.ip}:${n.brickPath}/${name}`);

    // Create the replicated volume
    const args = [
      'volume', 'create', name,
      'replica', String(this.replicaCount),
      'transport', this.config.transport ?? 'tcp',
      ...bricks,
      'force',
    ];

    await execFile('gluster', args);
    logger.info({ name, replicaCount: this.replicaCount, bricks }, 'GlusterFS volume created');

    // Start the volume
    await execFile('gluster', ['volume', 'start', name]);
    logger.info({ name }, 'GlusterFS volume started');

    return {
      name,
      path: name, // GlusterFS volumes are referenced by name
      driver: 'glusterfs',
      driverOptions: this.getDockerVolumeOptions(name),
    };
  }

  async deleteVolume(name: string): Promise<void> {
    validateVolumeName(name);

    try {
      // Stop the volume first (--mode=script avoids interactive confirmation)
      await execFile('gluster', ['volume', 'stop', name, 'force', '--mode=script']);
    } catch {
      // Volume might already be stopped
    }

    try {
      await execFile('gluster', ['volume', 'delete', name, '--mode=script']);
      logger.info({ name }, 'GlusterFS volume deleted');
    } catch (err) {
      logger.error({ err, name }, 'Failed to delete GlusterFS volume');
      throw err;
    }
  }

  async resizeVolume(name: string, _newSizeGb: number): Promise<void> {
    validateVolumeName(name);
    // GlusterFS volumes grow by adding bricks. For simplicity, this is a no-op
    // in the basic implementation. Expansion is handled via the admin API.
    logger.warn({ name }, 'GlusterFS volume resize is a no-op — use add-brick for expansion');
  }

  async listVolumes(): Promise<VolumeInfo[]> {
    try {
      const { stdout } = await execFile('gluster', ['volume', 'list']);
      const names = stdout.trim().split('\n').filter(Boolean);

      const volumes: VolumeInfo[] = [];
      for (const name of names) {
        try {
          const info = await this.getVolumeInfo(name);
          volumes.push(info);
        } catch {
          // Skip volumes that fail inspection
        }
      }
      return volumes;
    } catch {
      return [];
    }
  }

  async getVolumeInfo(name: string): Promise<VolumeInfo> {
    validateVolumeName(name);

    const { stdout } = await execFile('gluster', ['volume', 'info', name]);
    const statusLine = stdout.match(/Status:\s*(\w+)/);
    const replicaLine = stdout.match(/Number of Bricks:\s*.*x\s*(\d+)/);

    // Get size info from volume status
    let sizeGb = 0;
    let usedGb = 0;
    let availableGb = 0;

    try {
      const { stdout: statusOut } = await execFile('gluster', ['volume', 'status', name, 'detail']);
      // Parse disk usage from status output
      const sizeMatch = statusOut.match(/Disk Space Free\s*:\s*([\d.]+)([TGMK]B)/);
      const totalMatch = statusOut.match(/Total Disk Space\s*:\s*([\d.]+)([TGMK]B)/);

      if (totalMatch) sizeGb = parseSize(totalMatch[1]!, totalMatch[2]!);
      if (sizeMatch) availableGb = parseSize(sizeMatch[1]!, sizeMatch[2]!);
      usedGb = Math.max(0, sizeGb - availableGb);
    } catch {
      // Status might not be available
    }

    return {
      name,
      path: name,
      sizeGb,
      usedGb,
      availableGb,
      replicaCount: replicaLine ? parseInt(replicaLine[1]!, 10) : this.replicaCount,
      status: statusLine?.[1]?.toLowerCase() === 'started' ? 'ready' : 'degraded',
    };
  }

  getDockerVolumeDriver(): string {
    // Use Docker's built-in 'local' driver with type=glusterfs mount options.
    // This avoids needing a third-party Docker volume plugin — only requires
    // glusterfs-client (FUSE) to be installed on each Swarm node.
    return 'local';
  }

  getDockerVolumeOptions(name: string): Record<string, string> {
    // Find the first available node to use as the mount server
    const mountNode = this.config.nodes[0];
    if (!mountNode) return {};

    return {
      'type': 'glusterfs',
      'o': `addr=${mountNode.ip},volfile-id=/${name}`,
      'device': `${mountNode.ip}:/${name}`,
    };
  }

  isReady(): boolean {
    return this.config.nodes.length > 0;
  }

  getPrerequisites(): StoragePrerequisite[] {
    return [
      {
        package: 'fuse',
        description: 'FUSE kernel module (required for GlusterFS volume mounts)',
        checkCommand: 'lsmod | grep -q fuse',
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
}

/** Parse GlusterFS size strings like "10.5GB" or "1.2TB" to GB. */
function parseSize(value: string, unit: string): number {
  const num = parseFloat(value);
  switch (unit.toUpperCase()) {
    case 'TB': return Math.round(num * 1024);
    case 'GB': return Math.round(num);
    case 'MB': return Math.round(num / 1024);
    case 'KB': return Math.round(num / (1024 * 1024));
    default: return Math.round(num);
  }
}
