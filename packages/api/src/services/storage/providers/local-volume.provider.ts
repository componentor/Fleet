import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
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
 * Local volume provider — uses the host filesystem with optional NFS exports.
 * This is the default provider for dev and single-node setups.
 * Wraps the existing NFS service logic.
 */
export class LocalVolumeProvider implements VolumeStorageProvider {
  readonly name = 'local';

  async initialize(): Promise<void> {
    await mkdir(NFS_BASE_PATH, { recursive: true }).catch(() => {});
  }

  async createVolume(name: string, sizeGb: number, nodeId?: string): Promise<VolumeResult> {
    validateVolumeName(name);
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

  async deleteVolume(name: string): Promise<void> {
    validateVolumeName(name);
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

  isReady(): boolean {
    return true;
  }

  getPrerequisites(): StoragePrerequisite[] {
    return [];
  }

  async getHealth(): Promise<StorageHealth> {
    try {
      await execFile('ls', [NFS_BASE_PATH]);
      return { status: 'healthy', provider: 'local', message: 'Local filesystem accessible' };
    } catch {
      return { status: 'error', provider: 'local', message: 'Local storage path not accessible' };
    }
  }
}
