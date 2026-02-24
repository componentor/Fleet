import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rm, access, constants } from 'node:fs/promises';
import { logger } from '../../logger.js';
import type {
  VolumeStorageProvider,
  VolumeInfo,
  VolumeResult,
  StorageHealth,
  StoragePrerequisite,
} from '../storage-provider.js';

const execFile = promisify(execFileCb);

const NFS_BASE_PATH = process.env['NFS_BASE_PATH'] ?? '/srv/nfs';
const NFS_EXPORTS_FILE = process.env['NFS_EXPORTS_FILE'] ?? '/etc/exports';
const NFS_ALLOWED_NETWORK = process.env['NFS_ALLOWED_NETWORK'] ?? '10.0.0.0/8';

/** Validate volume name to prevent path traversal and shell injection. */
function validateVolumeName(name: string): void {
  if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || name.includes('..')) {
    throw new Error('Invalid volume name');
  }
}

/**
 * Local volume provider — uses plain Docker volumes by default.
 * When NFS is available (exportfs + /srv/nfs exists), volumes are also
 * exported via NFS for multi-node access. Without NFS, volumes are
 * Docker-managed local volumes (suitable for dev and single-node setups).
 */
export class LocalVolumeProvider implements VolumeStorageProvider {
  readonly name = 'local';
  private nfsAvailable = false;

  async initialize(): Promise<void> {
    // Detect whether NFS is actually available on this host
    this.nfsAvailable = await this.detectNfs();
    if (this.nfsAvailable) {
      await mkdir(NFS_BASE_PATH, { recursive: true }).catch(() => {});
      logger.info('Local volume provider initialized with NFS support');
    } else {
      logger.info('Local volume provider initialized — NFS not available, using plain Docker volumes');
    }
  }

  async createVolume(name: string, _sizeGb: number, _nodeId?: string): Promise<VolumeResult> {
    validateVolumeName(name);

    if (!this.nfsAvailable) {
      // No NFS — volumes are plain Docker named volumes managed by the Docker daemon.
      // No host directory or NFS export needed.
      return {
        name,
        path: name,
        driver: 'local',
        driverOptions: {},
      };
    }

    // NFS available — create host directory and export
    const volumePath = `${NFS_BASE_PATH}/${name}`;

    await execFile('mkdir', ['-p', volumePath]);
    await execFile('chown', ['nobody:nogroup', volumePath]).catch(() => {});
    await execFile('chmod', ['0770', volumePath]).catch(() => {});

    // Add to NFS exports
    const exportLine = `${volumePath} ${NFS_ALLOWED_NETWORK}(rw,sync,no_subtree_check,root_squash)`;
    const exportsContent = await readFile(NFS_EXPORTS_FILE, 'utf-8').catch(() => '');
    if (!exportsContent.includes(volumePath)) {
      await writeFile(NFS_EXPORTS_FILE, exportsContent.trimEnd() + '\n' + exportLine + '\n');
      await execFile('exportfs', ['-ra']).catch(() => {});
    }

    return {
      name,
      path: volumePath,
      driver: 'local',
      driverOptions: {},
    };
  }

  async ensureVolume(name: string): Promise<void> {
    if (!this.nfsAvailable) return;
    validateVolumeName(name);
    const volumePath = `${NFS_BASE_PATH}/${name}`;
    await mkdir(volumePath, { recursive: true });
  }

  async deleteVolume(name: string): Promise<void> {
    validateVolumeName(name);

    if (!this.nfsAvailable) return;

    const volumePath = `${NFS_BASE_PATH}/${name}`;

    // Remove from NFS exports
    const exportsContent = await readFile(NFS_EXPORTS_FILE, 'utf-8').catch(() => '');
    const filteredLines = exportsContent.split('\n').filter((line) => !line.includes(volumePath));
    await writeFile(NFS_EXPORTS_FILE, filteredLines.join('\n'));
    await execFile('exportfs', ['-ra']).catch(() => {});

    await rm(volumePath, { recursive: true, force: true });
  }

  async resizeVolume(_name: string, _newSizeGb: number): Promise<void> {
    // Local volumes don't have enforced size limits — no-op
  }

  async listVolumes(): Promise<VolumeInfo[]> {
    if (!this.nfsAvailable) return [];

    try {
      const { stdout } = await execFile('ls', ['-1', NFS_BASE_PATH]);
      const dirs = stdout.trim().split('\n').filter(Boolean);

      const volumes: VolumeInfo[] = [];
      for (const dir of dirs) {
        try {
          const info = await this.getVolumeInfo(dir);
          volumes.push(info);
        } catch {
          // Skip directories that fail inspection
        }
      }
      return volumes;
    } catch {
      return [];
    }
  }

  async getVolumeInfo(name: string): Promise<VolumeInfo> {
    validateVolumeName(name);

    if (!this.nfsAvailable) {
      return {
        name,
        path: name,
        sizeGb: 0,
        usedGb: 0,
        availableGb: 0,
        replicaCount: 1,
        status: 'ready',
      };
    }

    const volumePath = `${NFS_BASE_PATH}/${name}`;

    const { stdout } = await execFile('df', ['-BG', '--output=size,used,avail', volumePath]);
    const lines = stdout.trim().split('\n');
    const dataLine = lines[1]?.trim();

    if (!dataLine) {
      throw new Error(`Failed to get volume info for ${name}`);
    }

    const parts = dataLine.split(/\s+/);
    const sizeGb = parseInt(parts[0] ?? '0', 10);
    const usedGb = parseInt(parts[1] ?? '0', 10);
    const availableGb = parseInt(parts[2] ?? '0', 10);

    return {
      name,
      path: volumePath,
      sizeGb,
      usedGb,
      availableGb,
      replicaCount: 1,
      status: 'ready',
    };
  }

  getDockerVolumeDriver(): string {
    return 'local';
  }

  getDockerVolumeOptions(_name: string): Record<string, string> {
    return {};
  }

  /**
   * Returns true only when NFS is available and volumes can be shared across nodes.
   * When false, Docker uses plain named volumes (single-node only).
   */
  isReady(): boolean {
    return this.nfsAvailable;
  }

  getPrerequisites(): StoragePrerequisite[] {
    return [];
  }

  async getHealth(): Promise<StorageHealth> {
    if (!this.nfsAvailable) {
      return { status: 'healthy', provider: 'local', message: 'Using plain Docker volumes (NFS not configured)' };
    }

    try {
      await execFile('ls', [NFS_BASE_PATH]);
      return { status: 'healthy', provider: 'local', message: 'NFS storage accessible' };
    } catch {
      return { status: 'error', provider: 'local', message: 'NFS storage path not accessible' };
    }
  }

  /** Detect whether NFS server tools are available on the host. */
  private async detectNfs(): Promise<boolean> {
    try {
      // Check if NFS base path exists (or is at least writable)
      await access(NFS_BASE_PATH, constants.W_OK);
      // Check if exportfs is available (NFS server installed)
      await execFile('which', ['exportfs']);
      return true;
    } catch {
      return false;
    }
  }
}
