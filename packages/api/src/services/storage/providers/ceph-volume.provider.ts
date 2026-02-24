import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  VolumeStorageProvider,
  VolumeInfo,
  VolumeResult,
  StorageHealth,
  StorageNodeHealth,
  StoragePrerequisite,
} from '../storage-provider.js';

const execFile = promisify(execFileCb);

/** Strict volume name validation — alphanumeric, hyphens, dots only. */
const VOLUME_NAME_RE = /^[a-z0-9][a-z0-9.\-]{0,126}[a-z0-9]$/;

/** Validate Ceph monitor address list — only allow safe characters. */
function validateMonitors(monitors: string): void {
  if (!monitors) return;
  for (const part of monitors.split(',')) {
    const trimmed = part.trim();
    if (!/^[a-zA-Z0-9.:[\]-]+$/.test(trimmed)) {
      throw new Error(`Invalid Ceph monitor address: ${trimmed}`);
    }
  }
}

/** Validate Ceph user name — alphanumeric, dots, hyphens, underscores. */
function validateCephUser(user: string): void {
  if (!user || !/^[a-zA-Z0-9._-]+$/.test(user)) {
    throw new Error(`Invalid Ceph user: ${user}`);
  }
}

/** Validate file path — must be absolute, no shell metacharacters. */
function validateFilePath(path: string): void {
  if (!path || !path.startsWith('/') || /[;&|`$"'\\]/.test(path) || path.includes('..')) {
    throw new Error(`Invalid file path: ${path}`);
  }
}

/** Validate pool name — alphanumeric, dots, hyphens, underscores. */
function validatePoolName(pool: string): void {
  if (!pool || !/^[a-zA-Z0-9._-]+$/.test(pool) || pool.length > 128) {
    throw new Error(`Invalid pool name: ${pool}`);
  }
}

/** Validate snapshot name — alphanumeric, dots, hyphens, underscores. */
function validateSnapName(name: string): void {
  if (!name || !/^[a-zA-Z0-9._-]+$/.test(name) || name.length > 128) {
    throw new Error(`Invalid snapshot name: ${name}`);
  }
}

/** Validate filesystem type — only allow known types. */
function validateFsType(fsType: string): void {
  const allowed = ['xfs', 'ext4', 'ext3', 'btrfs'];
  if (!allowed.includes(fsType)) {
    throw new Error(`Invalid filesystem type: ${fsType}. Allowed: ${allowed.join(', ')}`);
  }
}

/**
 * Ceph RADOS Block Device (RBD) volume provider.
 *
 * Uses the `rbd` CLI to manage block device images in a Ceph cluster.
 * Volumes are RBD images that can be mapped to any node and mounted into
 * Docker containers via the rbd-nbd or krbd kernel driver.
 *
 * Config:
 *   pool        — Ceph pool name (default: 'fleet-volumes')
 *   monitors    — Comma-separated list of Ceph monitor addresses
 *   user        — Ceph auth user (default: 'admin')
 *   keyring     — Path to Ceph keyring file
 *   fsType      — Filesystem type for new images (default: 'xfs')
 *   dataPool    — Optional erasure-coded data pool for EC profiles
 */
export class CephVolumeProvider implements VolumeStorageProvider {
  readonly name = 'ceph';

  private pool: string;
  private monitors: string;
  private user: string;
  private keyring: string;
  private fsType: string;
  private dataPool: string | null;

  constructor(config: Record<string, any>) {
    this.pool = config.pool ?? 'fleet-volumes';
    this.monitors = config.monitors ?? '';
    this.user = config.user ?? 'admin';
    this.keyring = config.keyring ?? '/etc/ceph/ceph.client.admin.keyring';
    this.fsType = config.fsType ?? 'xfs';
    this.dataPool = config.dataPool ?? null;

    // Validate all config values that will be passed to CLI
    validatePoolName(this.pool);
    if (this.monitors) validateMonitors(this.monitors);
    validateCephUser(this.user);
    validateFilePath(this.keyring);
    validateFsType(this.fsType);
    if (this.dataPool) validatePoolName(this.dataPool);
  }

  async initialize(): Promise<void> {
    // Verify we can reach the Ceph cluster
    await this.rbd(['pool', 'stats', this.pool]);

    // Ensure the pool exists (create if not)
    try {
      await this.rbd(['pool', 'stats', this.pool]);
    } catch {
      // Pool doesn't exist — create it (requires admin privileges)
      await this.ceph(['osd', 'pool', 'create', this.pool, '128']);
      await this.ceph(['osd', 'pool', 'application', 'enable', this.pool, 'rbd']);
      await this.rbd(['pool', 'init', this.pool]);
    }
  }

  async createVolume(name: string, sizeGb: number, _nodeId?: string): Promise<VolumeResult> {
    this.validateName(name);

    const args = [
      'create',
      `${this.pool}/${name}`,
      '--size', `${sizeGb * 1024}`, // RBD uses MB
      '--image-feature', 'layering,exclusive-lock',
    ];

    if (this.dataPool) {
      args.push('--data-pool', this.dataPool);
    }

    await this.rbd(args);

    // Map the image, create a filesystem, and leave it mapped for Docker
    const device = await this.mapImage(name);
    await execFile('mkfs', ['-t', this.fsType, device], { timeout: 60_000 });
    // Leave mapped — Docker's local driver will mount the device directly.
    // Add to rbdmap so it persists across reboots.
    try {
      await execFile('sh', ['-c', `echo '${this.pool}/${name}' >> /etc/ceph/rbdmap`], { timeout: 5_000 });
    } catch { /* rbdmap may not exist yet, non-fatal */ }

    return {
      name,
      path: `/dev/rbd/${this.pool}/${name}`,
      driver: 'local',
      driverOptions: this.getDockerVolumeOptions(name),
    };
  }

  async deleteVolume(name: string): Promise<void> {
    this.validateName(name);

    // Unmap if mapped
    try {
      await this.unmapImage(name);
    } catch {
      // Not mapped, that's fine
    }

    // Move to trash first (allows undo), then purge
    try {
      await this.rbd(['trash', 'move', `${this.pool}/${name}`]);
    } catch {
      // If trash move fails, try direct remove
      await this.rbd(['remove', `${this.pool}/${name}`]);
    }
  }

  async resizeVolume(name: string, newSizeGb: number): Promise<void> {
    this.validateName(name);
    await this.rbd([
      'resize',
      `${this.pool}/${name}`,
      '--size', `${newSizeGb * 1024}`,
      '--allow-shrink',
    ]);
  }

  async listVolumes(): Promise<VolumeInfo[]> {
    const { stdout } = await this.rbd(['ls', this.pool, '--format', 'json']);
    const images: string[] = JSON.parse(stdout);
    const results: VolumeInfo[] = [];

    for (const imageName of images) {
      try {
        const info = await this.getVolumeInfo(imageName);
        results.push(info);
      } catch {
        results.push({
          name: imageName,
          path: `/dev/rbd/${this.pool}/${imageName}`,
          sizeGb: 0,
          usedGb: 0,
          availableGb: 0,
          status: 'error',
        });
      }
    }

    return results;
  }

  async getVolumeInfo(name: string): Promise<VolumeInfo> {
    this.validateName(name);
    const { stdout } = await this.rbd(['info', `${this.pool}/${name}`, '--format', 'json']);
    const info = JSON.parse(stdout);

    const sizeBytes = info.size ?? 0;
    const sizeGb = Math.round(sizeBytes / (1024 * 1024 * 1024) * 100) / 100;

    // Get disk usage for actual used space
    let usedGb = 0;
    try {
      const { stdout: duOut } = await this.rbd(['du', `${this.pool}/${name}`, '--format', 'json']);
      const du = JSON.parse(duOut);
      const usedBytes = du.images?.[0]?.used_size ?? du.used_size ?? 0;
      usedGb = Math.round(usedBytes / (1024 * 1024 * 1024) * 100) / 100;
    } catch {
      // du might not be available for all image types
    }

    return {
      name,
      path: `/dev/rbd/${this.pool}/${name}`,
      sizeGb,
      usedGb,
      availableGb: sizeGb - usedGb,
      replicaCount: info.objects ?? undefined,
      status: 'ready',
    };
  }

  getDockerVolumeDriver(): string {
    // Use Docker's built-in 'local' driver with a pre-mapped RBD block device.
    // Requires ceph-common (kernel rbd module) on each Swarm node and the
    // RBD image to be mapped via `rbd map` before Docker creates the volume.
    return 'local';
  }

  getDockerVolumeOptions(name: string): Record<string, string> {
    if (!this.monitors) return {};

    // Docker local driver mounts the pre-mapped kernel RBD device.
    // The RBD image must be mapped on the node (via rbd map or rbdmap service)
    // before Docker tries to create this volume.
    return {
      'type': this.fsType,
      'device': `/dev/rbd/${this.pool}/${name}`,
      'o': 'rw',
    };
  }

  isReady(): boolean {
    return !!this.monitors;
  }

  getPrerequisites(): StoragePrerequisite[] {
    return [
      {
        package: 'ceph-common',
        description: 'Ceph client tools and RBD kernel module (required for Docker volume mounts)',
        checkCommand: 'which rbd',
        installCommand: 'apt-get install -y ceph-common && modprobe rbd && systemctl enable rbdmap',
      },
    ];
  }

  /**
   * Get the rbd map command for a volume — used by storage-manager to map
   * RBD images on all Swarm nodes after volume creation.
   */
  getRbdMapCommand(name: string): string {
    const args = [`rbd map ${this.pool}/${name} --id ${this.user}`];
    if (this.monitors) args.push(`-m ${this.monitors}`);
    if (this.keyring) args.push(`--keyring ${this.keyring}`);
    return args.join(' ');
  }

  async getHealth(): Promise<StorageHealth> {
    try {
      const { stdout } = await this.ceph(['health', '--format', 'json']);
      const health = JSON.parse(stdout);
      const cephStatus = health.status ?? 'HEALTH_UNKNOWN';

      let status: StorageHealth['status'] = 'healthy';
      let message = `Ceph cluster: ${cephStatus}`;

      if (cephStatus === 'HEALTH_WARN') {
        status = 'degraded';
        const checks = Object.keys(health.checks ?? {});
        message += ` — ${checks.join(', ')}`;
      } else if (cephStatus === 'HEALTH_ERR') {
        status = 'error';
        const checks = Object.keys(health.checks ?? {});
        message += ` — ${checks.join(', ')}`;
      }

      // Get OSD status for per-node health
      const nodes: StorageNodeHealth[] = [];
      try {
        const { stdout: osdDump } = await this.ceph(['osd', 'df', '--format', 'json']);
        const osdData = JSON.parse(osdDump);
        const osds = osdData.nodes ?? [];

        for (const osd of osds) {
          nodes.push({
            hostname: osd.name ?? `osd.${osd.id}`,
            ipAddress: osd.crush_weight !== undefined ? `osd.${osd.id}` : 'unknown',
            status: osd.status === 'up' ? 'healthy' : 'error',
            capacityGb: Math.round((osd.kb ?? 0) / (1024 * 1024)),
            usedGb: Math.round((osd.kb_used ?? 0) / (1024 * 1024)),
            message: `${osd.utilization?.toFixed(1) ?? '?'}% utilized`,
          });
        }
      } catch {
        // OSD info not available
      }

      return { status, provider: 'ceph', message, nodes };
    } catch (err) {
      return {
        status: 'error',
        provider: 'ceph',
        message: `Cannot reach Ceph cluster: ${err}`,
      };
    }
  }

  // ── Ceph cluster management ───────────────────────────────────────────

  /** Create a new Ceph pool with replication settings. */
  async createPool(poolName: string, pgNum: number = 128, replicaSize: number = 3): Promise<void> {
    validatePoolName(poolName);
    if (pgNum < 1 || pgNum > 65536 || !Number.isInteger(pgNum)) throw new Error('Invalid PG number');
    if (replicaSize < 1 || replicaSize > 10 || !Number.isInteger(replicaSize)) throw new Error('Invalid replica size');
    await this.ceph(['osd', 'pool', 'create', poolName, String(pgNum)]);
    await this.ceph(['osd', 'pool', 'set', poolName, 'size', String(replicaSize)]);
    await this.ceph(['osd', 'pool', 'application', 'enable', poolName, 'rbd']);
    await this.rbd(['pool', 'init', poolName]);
  }

  /** Enable snapshots for a volume. */
  async createSnapshot(volumeName: string, snapName: string): Promise<void> {
    this.validateName(volumeName);
    validateSnapName(snapName);
    await this.rbd(['snap', 'create', `${this.pool}/${volumeName}@${snapName}`]);
  }

  /** List snapshots for a volume. */
  async listSnapshots(volumeName: string): Promise<Array<{ name: string; size: number }>> {
    this.validateName(volumeName);
    const { stdout } = await this.rbd(['snap', 'ls', `${this.pool}/${volumeName}`, '--format', 'json']);
    return JSON.parse(stdout);
  }

  /** Rollback a volume to a snapshot. */
  async rollbackSnapshot(volumeName: string, snapName: string): Promise<void> {
    this.validateName(volumeName);
    validateSnapName(snapName);
    await this.rbd(['snap', 'rollback', `${this.pool}/${volumeName}@${snapName}`]);
  }

  // ── Private helpers ───────────────────────────────────────────────────

  private validateName(name: string): void {
    if (!VOLUME_NAME_RE.test(name)) {
      throw new Error(`Invalid volume name: ${name}`);
    }
  }

  private async rbd(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const fullArgs = [...args];
    if (this.monitors) {
      fullArgs.push('-m', this.monitors);
    }
    if (this.keyring) {
      fullArgs.push('--keyring', this.keyring);
    }
    fullArgs.push('--id', this.user);

    return execFile('rbd', fullArgs, { timeout: 60_000 });
  }

  private async ceph(args: string[]): Promise<{ stdout: string; stderr: string }> {
    const fullArgs = [...args];
    if (this.monitors) {
      fullArgs.push('-m', this.monitors);
    }
    if (this.keyring) {
      fullArgs.push('--keyring', this.keyring);
    }
    fullArgs.push('--id', this.user);

    return execFile('ceph', fullArgs, { timeout: 60_000 });
  }

  private async mapImage(name: string): Promise<string> {
    const { stdout } = await this.rbd([
      'map', `${this.pool}/${name}`,
      '--id', this.user,
    ]);
    return stdout.trim(); // e.g. /dev/rbd0
  }

  private async unmapImage(name: string): Promise<void> {
    await this.rbd(['unmap', `/dev/rbd/${this.pool}/${name}`]);
  }
}
