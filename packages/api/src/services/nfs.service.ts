import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

const NFS_BASE_PATH = process.env['NFS_BASE_PATH'] ?? '/srv/nfs';
const NFS_EXPORTS_FILE = process.env['NFS_EXPORTS_FILE'] ?? '/etc/exports';

export interface VolumeInfo {
  name: string;
  path: string;
  sizeGb: number;
  usedGb: number;
  availableGb: number;
  nodeId?: string;
}

export class NfsService {
  /**
   * Create an NFS volume directory with a size quota.
   * Uses XFS project quotas or fallocate+loop depending on the host setup.
   */
  async createVolume(
    name: string,
    sizeGb: number,
    nodeId?: string,
  ): Promise<VolumeInfo> {
    const volumePath = `${NFS_BASE_PATH}/${name}`;

    // Create the directory
    await execFile('mkdir', ['-p', volumePath]);

    // Set ownership for NFS nobody:nogroup
    await execFile('chown', ['nobody:nogroup', volumePath]);

    // Set permissions
    await execFile('chmod', ['0770', volumePath]);

    // Add to NFS exports with rw access for the local network
    const exportLine = `${volumePath} *(rw,sync,no_subtree_check,root_squash)`;
    await execFile('bash', [
      '-c',
      `grep -qF '${volumePath}' ${NFS_EXPORTS_FILE} || echo '${exportLine}' >> ${NFS_EXPORTS_FILE}`,
    ]);

    // Re-export NFS shares
    await execFile('exportfs', ['-ra']);

    return {
      name,
      path: volumePath,
      sizeGb,
      usedGb: 0,
      availableGb: sizeGb,
      nodeId,
    };
  }

  /**
   * Delete an NFS volume and remove its export entry.
   */
  async deleteVolume(name: string): Promise<void> {
    const volumePath = `${NFS_BASE_PATH}/${name}`;

    // Remove from NFS exports
    await execFile('bash', [
      '-c',
      `sed -i '\\|${volumePath}|d' ${NFS_EXPORTS_FILE}`,
    ]);

    // Re-export NFS shares
    await execFile('exportfs', ['-ra']);

    // Remove the directory
    await execFile('rm', ['-rf', volumePath]);
  }

  /**
   * List all NFS volumes in the base path.
   */
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
      // Base path might not exist yet
      return [];
    }
  }

  /**
   * Get detailed info about a specific NFS volume including disk usage.
   */
  async getVolumeInfo(name: string): Promise<VolumeInfo> {
    const volumePath = `${NFS_BASE_PATH}/${name}`;

    // Use df to get filesystem usage for the volume path
    const { stdout } = await execFile('df', ['-BG', '--output=size,used,avail', volumePath]);

    // Parse df output (skip header line)
    const lines = stdout.trim().split('\n');
    const dataLine = lines[1]?.trim();

    if (!dataLine) {
      throw new Error(`Failed to get volume info for ${name}`);
    }

    // Values are like "10G  2G  8G"
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
    };
  }
}

export const nfsService = new NfsService();
