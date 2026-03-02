import Docker from 'dockerode'
import { cpus, freemem, totalmem, hostname as osHostname, platform } from 'node:os'
import { statfsSync, readFileSync, readdirSync } from 'node:fs'
import { logger } from './logger.js'

const ORCHESTRATOR = process.env.ORCHESTRATOR || 'swarm'
const IS_K8S = ORCHESTRATOR === 'kubernetes'

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock'
// Only initialise Docker client when running in Swarm mode
const docker = IS_K8S ? (null as unknown as Docker) : new Docker({ socketPath: DOCKER_SOCKET })

const FETCH_TIMEOUT_MS = 10_000 // 10 second timeout for API calls
const UNHEALTHY_THRESHOLD = 10 // Consider unhealthy after 10 consecutive failures

// Resolve the real node hostname
// In Swarm: os.hostname() returns container ID, so use docker.info().Name
// In K8s: NODE_NAME env var is set via Downward API
let resolvedHostname = ''
async function getNodeHostname(): Promise<string> {
  if (resolvedHostname) return resolvedHostname
  if (IS_K8S) {
    resolvedHostname = process.env.NODE_NAME || osHostname()
    return resolvedHostname
  }
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

    // Get container count + per-container bandwidth snapshots
    let containerCount = 0
    const containerBandwidth: Record<string, { rx: number; tx: number }> = {}

    if (IS_K8S) {
      // In K8s mode, use Kubelet summary API for container metrics
      try {
        const resp = await fetch('https://localhost:10250/stats/summary', {
          headers: { Authorization: `Bearer ${readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token', 'utf-8')}` },
        }).catch(() =>
          // Fallback to insecure kubelet read-only port
          fetch('http://localhost:10255/stats/summary'),
        )
        if (resp.ok) {
          const summary = await resp.json() as any
          const pods = summary.pods ?? []
          containerCount = pods.length
          for (const pod of pods) {
            const name = pod.podRef?.name ?? ''
            const net = pod.network?.interfaces?.[0]
            if (net) {
              containerBandwidth[name] = {
                rx: net.rxBytes ?? 0,
                tx: net.txBytes ?? 0,
              }
            }
          }
        }
      } catch {
        // Kubelet metrics not available
      }
    } else {
      // Swarm mode: use Docker API
      try {
        const containers = await docker.listContainers()
        containerCount = containers.length

        const BATCH_SIZE = 20
        for (let i = 0; i < containers.length; i += BATCH_SIZE) {
          const batch = containers.slice(i, i + BATCH_SIZE)
          const results = await Promise.allSettled(
            batch.map(async (c) => {
              const stats = await docker.getContainer(c.Id).stats({ stream: false }) as any
              let rx = 0
              let tx = 0
              if (stats.networks) {
                for (const net of Object.values(stats.networks) as any[]) {
                  rx += net.rx_bytes ?? 0
                  tx += net.tx_bytes ?? 0
                }
              }
              return { id: c.Id, rx, tx }
            }),
          )
          for (const r of results) {
            if (r.status === 'fulfilled') {
              containerBandwidth[r.value.id] = { rx: r.value.rx, tx: r.value.tx }
            }
          }
        }
      } catch {
        // Docker socket not available
      }
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
      containerBandwidth,
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
