import Docker from 'dockerode'
import { cpus, freemem, totalmem, hostname } from 'node:os'

const docker = new Docker({ socketPath: '/var/run/docker.sock' })

export class NodeMonitor {
  private intervalId: ReturnType<typeof setInterval> | null = null
  private apiUrl: string
  private nodeId: string

  constructor(apiUrl: string, nodeId: string) {
    this.apiUrl = apiUrl
    this.nodeId = nodeId
  }

  start(intervalMs: number) {
    this.intervalId = setInterval(() => {
      this.sendHeartbeat().catch((err) =>
        console.error('[monitor] Heartbeat failed:', err.message)
      )
    }, intervalMs)

    // Send initial heartbeat
    this.sendHeartbeat().catch(() => {})
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

    // Get container count on this node
    const containers = await docker.listContainers()

    return {
      hostname: hostname(),
      cpuCount,
      memTotal,
      memUsed,
      memFree,
      containerCount: containers.length,
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
  }
}
