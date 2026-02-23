import Docker from 'dockerode'
import { cpus, freemem, totalmem, hostname as osHostname, platform } from 'node:os'
import { statfsSync, readFileSync, readdirSync } from 'node:fs'
import { logger } from './logger.js'

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'
const docker = new Docker({ socketPath: DOCKER_SOCKET })

const FETCH_TIMEOUT_MS = 10_000 // 10 second timeout for API calls
const UNHEALTHY_THRESHOLD = 10 // Consider unhealthy after 10 consecutive failures

// Resolve the real node hostname from Docker Swarm info (os.hostname() returns container ID)
let resolvedHostname = ''
async function getNodeHostname(): Promise<string> {
  if (resolvedHostname) return resolvedHostname
  try {
    const info = await docker.info()
    if (info.Name) {
      resolvedHostname = info.Name
      return resolvedHostname
    }
  } catch { /* Docker not available */ }
  resolvedHostname = osHostname()
  return resolvedHostname
}

/**
 * Detect disk type by reading /sys/block/{device}/queue/rotational on Linux.
 * Returns 'ssd' (0), 'hdd' (1), or 'unknown' on failure / non-Linux.
 */
function detectDiskType(): 'ssd' | 'hdd' | 'unknown' {
  if (platform() !== 'linux') return 'unknown'
  try {
    const blocks = readdirSync('/sys/block')
    // Check common block device prefixes (sd*, nvme*, vd*, xvd*)
    for (const dev of blocks) {
      if (/^(sd|nvme|vd|xvd)/.test(dev)) {
        const rotational = readFileSync(`/sys/block/${dev}/queue/rotational`, 'utf-8').trim()
        if (rotational === '0') return 'ssd'
        if (rotational === '1') return 'hdd'
      }
    }
  } catch {
    // Not available — fall through
  }
  return 'unknown'
}

/**
 * Collect disk usage stats for the root partition using Node.js built-in statfsSync.
 */
function collectDiskStats(): { diskTotal: number; diskUsed: number; diskFree: number; diskType: 'ssd' | 'hdd' | 'unknown' } {
  try {
    const stats = statfsSync('/')
    const diskTotal = stats.blocks * stats.bsize
    const diskFree = stats.bavail * stats.bsize
    const diskUsed = diskTotal - diskFree
    const diskType = detectDiskType()
    return { diskTotal, diskUsed, diskFree, diskType }
  } catch {
    return { diskTotal: 0, diskUsed: 0, diskFree: 0, diskType: 'unknown' }
  }
}

export class NodeMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private apiUrl: string
  private nodeId: string
  private authToken: string | undefined
  private _consecutiveFailures = 0
  private sending = false // Guard against overlapping heartbeats

  constructor(apiUrl: string, nodeId: string, authToken?: string) {
    this.apiUrl = apiUrl
    this.nodeId = nodeId
    this.authToken = authToken
  }

  start(intervalMs: number) {
    this.intervalId = setInterval(() => {
      // Skip if previous heartbeat is still in flight
      if (this.sending) return

      this.sendHeartbeat().catch((err) => {
        this._consecutiveFailures++

        // Log first failure, then every 5th
        if (this._consecutiveFailures <= 1 || this._consecutiveFailures % 5 === 0) {
          logger.error({
            err: err.message,
            failures: this._consecutiveFailures,
          }, 'Heartbeat failed')
        }
      })
    }, intervalMs)

    // Send initial heartbeat
    this.sendHeartbeat().catch((err) => {
      this._consecutiveFailures++
      logger.error({ err: err.message }, 'Initial heartbeat failed')
    })
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
  }

  isHealthy(): boolean {
    return this._consecutiveFailures < UNHEALTHY_THRESHOLD
  }

  getConsecutiveFailures(): number {
    return this._consecutiveFailures
  }

  private async collectMetrics() {
    const cpuCount = cpus().length
    const memTotal = totalmem()
    const memFree = freemem()
    const memUsed = memTotal - memFree

    // Get container count — gracefully handle Docker unavailability
    let containerCount = 0
    try {
      const containers = await docker.listContainers()
      containerCount = containers.length
    } catch {
      // Docker socket not available
    }

    // Collect disk metrics
    const { diskTotal, diskUsed, diskFree, diskType } = collectDiskStats()

    return {
      hostname: await getNodeHostname(),
      cpuCount,
      memTotal,
      memUsed,
      memFree,
      containerCount,
      diskTotal,
      diskUsed,
      diskFree,
      diskType,
      timestamp: new Date().toISOString(),
    }
  }

  private async sendHeartbeat() {
    this.sending = true
    try {
      const metrics = await this.collectMetrics()

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`
      }

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

      try {
        const response = await fetch(`${this.apiUrl}/api/v1/nodes/${this.nodeId}/heartbeat`, {
          method: 'POST',
          headers,
          body: JSON.stringify(metrics),
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Heartbeat response: ${response.status}`)
        }
      } finally {
        clearTimeout(timeout)
      }

      // Reset failure counter on success
      this._consecutiveFailures = 0
    } finally {
      this.sending = false
    }
  }
}
