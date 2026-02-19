/**
 * NFS Service — thin compatibility wrapper around the Storage Manager.
 *
 * Existing code that imports nfsService continues to work, but all
 * operations now go through the unified storage layer.
 */
import { storageManager } from './storage/storage-manager.js';
import type { VolumeInfo } from './storage/storage-provider.js';

export type { VolumeInfo };

export class NfsService {
  async createVolume(name: string, sizeGb: number, nodeId?: string): Promise<VolumeInfo> {
    const result = await storageManager.volumes.createVolume(name, sizeGb, nodeId);
    return storageManager.volumes.getVolumeInfo(result.name);
  }

  async deleteVolume(name: string): Promise<void> {
    await storageManager.volumes.deleteVolume(name);
  }

  async listVolumes(): Promise<VolumeInfo[]> {
    return storageManager.volumes.listVolumes();
  }

  async getVolumeInfo(name: string): Promise<VolumeInfo> {
    return storageManager.volumes.getVolumeInfo(name);
  }
}

export const nfsService = new NfsService();
