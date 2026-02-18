import Docker from 'dockerode'
import { cpus, freemem, totalmem, hostname } from 'node:os'
import { logger } from './logger.js'

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'
const docker = new Docker({ socketPath: DOCKER_SOCKET })

const FETCH_TIMEOUT_MS = 10_000 // 10 second timeout for API calls
const UNHEALTHY_THRESHOLD = 10 // Consider unhealthy after 10 consecutive failures

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

    return {
      hostname: hostname(),
      cpuCount,
      memTotal,
      memUsed,
      memFree,
      containerCount,
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
