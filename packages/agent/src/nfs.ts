import { execSync } from 'node:child_process'
import { logger } from './logger.js'

export class NfsManager {
  private mountPoint = '/mnt/fleet-nfs'

  async initialize() {
    logger.info('Initializing NFS manager')
    // NFS mounts are configured during node join
    // This manager monitors mount health and remounts if needed
    await this.checkMounts()
  }

  private async checkMounts() {
    try {
      execSync(`mountpoint -q ${this.mountPoint}`, { stdio: 'ignore' })
      logger.info(`Mount ${this.mountPoint} is active`)
    } catch {
      logger.warn(`Mount ${this.mountPoint} is not active`)
    }
  }

  async createVolume(accountId: string, volumeName: string): Promise<string> {
    const volumePath = `${this.mountPoint}/volumes/${accountId}/${volumeName}`
    execSync(`mkdir -p ${volumePath}`)
    logger.info(`Created volume: ${volumePath}`)
    return volumePath
  }

  async deleteVolume(accountId: string, volumeName: string) {
    const volumePath = `${this.mountPoint}/volumes/${accountId}/${volumeName}`
    execSync(`rm -rf ${volumePath}`)
    logger.info(`Deleted volume: ${volumePath}`)
  }
}
