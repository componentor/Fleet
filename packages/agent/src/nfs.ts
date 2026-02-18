import { mkdirSync, rmSync, statSync, existsSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { resolve } from 'node:path'
import { logger } from './logger.js'

export class NfsManager {
  private mountPoint = '/mnt/fleet-nfs'
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null

  async initialize() {
    logger.info('Initializing NFS manager')
    await this.checkMounts()

    // Periodically check mount health every 60 seconds
    this.healthCheckInterval = setInterval(() => {
      this.checkAndRemount().catch((err) => {
        logger.error({ err: (err as Error).message }, 'NFS health check failed')
      })
    }, 60_000)

    if (this.healthCheckInterval && typeof this.healthCheckInterval === 'object' && 'unref' in this.healthCheckInterval) {
      this.healthCheckInterval.unref()
    }
  }

  stop() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
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

  private async checkAndRemount() {
    if (!existsSync(this.mountPoint)) return

    try {
      statSync(this.mountPoint)
    } catch {
      logger.warn(`Mount ${this.mountPoint} appears stale, attempting remount`)
      try {
        execSync(`mount -o remount ${this.mountPoint}`, { timeout: 30_000 })
        logger.info(`Successfully remounted ${this.mountPoint}`)
      } catch (remountErr) {
        logger.error({ err: (remountErr as Error).message }, `Failed to remount ${this.mountPoint}`)
      }
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
