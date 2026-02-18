import { mkdirSync, rmSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { logger } from './logger.js'

export class NfsManager {
  private mountPoint = '/mnt/fleet-nfs'

  async initialize() {
    logger.info('Initializing NFS manager')
    // NFS mounts are configured during node join
    // This manager monitors mount health and remounts if needed
    await this.checkMounts()
  }

  private validateName(name: string, label: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(`Invalid ${label}: must be alphanumeric with hyphens/underscores only`)
    }
  }

  private async checkMounts() {
    try {
      const stats = statSync(this.mountPoint)
      if (stats.isDirectory()) {
        logger.info(`Mount ${this.mountPoint} is active`)
      } else {
        logger.warn(`Mount ${this.mountPoint} exists but is not a directory`)
      }
    } catch {
      logger.warn(`Mount ${this.mountPoint} is not active`)
    }
  }

  async createVolume(accountId: string, volumeName: string): Promise<string> {
    this.validateName(accountId, 'accountId')
    this.validateName(volumeName, 'volumeName')
    const volumePath = resolve(this.mountPoint, 'volumes', accountId, volumeName)
    if (!volumePath.startsWith(this.mountPoint)) {
      throw new Error('Path traversal detected')
    }
    mkdirSync(volumePath, { recursive: true })
    logger.info(`Created volume: ${volumePath}`)
    return volumePath
  }

  async deleteVolume(accountId: string, volumeName: string) {
    this.validateName(accountId, 'accountId')
    this.validateName(volumeName, 'volumeName')
    const volumePath = resolve(this.mountPoint, 'volumes', accountId, volumeName)
    if (!volumePath.startsWith(this.mountPoint)) {
      throw new Error('Path traversal detected')
    }
    rmSync(volumePath, { recursive: true, force: true })
    logger.info(`Deleted volume: ${volumePath}`)
  }
}
