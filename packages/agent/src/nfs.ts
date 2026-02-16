import { execSync } from 'node:child_process'

export class NfsManager {
  private mountPoint = '/mnt/fleet-nfs'

  async initialize() {
    console.log('[nfs] Initializing NFS manager')
    // NFS mounts are configured during node join
    // This manager monitors mount health and remounts if needed
    await this.checkMounts()
  }

  private async checkMounts() {
    try {
      execSync(`mountpoint -q ${this.mountPoint}`, { stdio: 'ignore' })
      console.log(`[nfs] Mount ${this.mountPoint} is active`)
    } catch {
      console.warn(`[nfs] Mount ${this.mountPoint} is not active`)
    }
  }

  async createVolume(accountId: string, volumeName: string): Promise<string> {
    const volumePath = `${this.mountPoint}/volumes/${accountId}/${volumeName}`
    execSync(`mkdir -p ${volumePath}`)
    console.log(`[nfs] Created volume: ${volumePath}`)
    return volumePath
  }

  async deleteVolume(accountId: string, volumeName: string) {
    const volumePath = `${this.mountPoint}/volumes/${accountId}/${volumeName}`
    execSync(`rm -rf ${volumePath}`)
    console.log(`[nfs] Deleted volume: ${volumePath}`)
  }
}
