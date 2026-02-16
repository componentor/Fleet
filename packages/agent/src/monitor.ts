import Docker from 'dockerode'
import { cpus, freemem, totalmem, hostname } from 'node:os'

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'
const docker = new Docker({ socketPath: DOCKER_SOCKET })

export class NodeMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private apiUrl: string
  private nodeId: string
  private consecutiveFailures = 0

  constructor(apiUrl: string, nodeId: string) {
    this.apiUrl = apiUrl
    this.nodeId = nodeId
  }

  start(intervalMs: number) {
    this.intervalId = setInterval(() => {
      this.sendHeartbeat().catch((err) => {
        this.consecutiveFailures++
        // Only log every 5th failure to avoid spamming
        if (this.consecutiveFailures <= 1 || this.consecutiveFailures % 5 === 0) {
          console.error(`[monitor] Heartbeat failed (${this.consecutiveFailures}x):`, err.message)
        }
      })
    }, intervalMs)

    // Send initial heartbeat
    this.sendHeartbeat().catch((err) => {
      this.consecutiveFailures++
      console.error('[monitor] Initial heartbeat failed:', err.message)
    })
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
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
    const metrics = await this.collectMetrics()

    const response = await fetch(`${this.apiUrl}/api/v1/nodes/${this.nodeId}/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metrics),
    })

    if (!response.ok) {
      throw new Error(`Heartbeat response: ${response.status}`)
    }

    // Reset failure counter on success
    this.consecutiveFailures = 0
  }
}
