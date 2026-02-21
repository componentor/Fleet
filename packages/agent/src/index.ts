import { createServer } from 'node:http'
import { execSync } from 'node:child_process'
import { NodeMonitor } from './monitor.js'
import { NfsManager } from './nfs.js'
import { logger } from './logger.js'

function detectNodeId(): string {
  if (process.env.NODE_ID) return process.env.NODE_ID
  // Auto-detect Docker Swarm node ID via docker info
  try {
    const swarmNodeId = execSync("docker info --format '{{.Swarm.NodeID}}'", { timeout: 5000 })
      .toString().trim().replace(/'/g, '')
    if (swarmNodeId && swarmNodeId !== '') return swarmNodeId
  } catch { /* docker not available or not in swarm */ }
  return 'unknown'
}

const HEARTBEAT_INTERVAL = 30_000 // 30 seconds
const API_URL = process.env.API_URL || 'http://localhost:3000'
const NODE_ID = detectNodeId()
const NODE_AUTH_TOKEN = process.env.NODE_AUTH_TOKEN
const HEALTH_PORT = parseInt(process.env.HEALTH_PORT || '3001', 10)

if (!NODE_AUTH_TOKEN) {
  if (process.env.NODE_ENV === 'production') {
    logger.error('NODE_AUTH_TOKEN is required — set it to match the API server')
    process.exit(1)
  }
  logger.warn('NODE_AUTH_TOKEN not set — heartbeat auth disabled (dev mode)')
}

// Register shutdown handlers early — before any async work
let monitor: NodeMonitor | undefined
let nfs: NfsManager | undefined
let healthServer: ReturnType<typeof createServer> | undefined
let shuttingDown = false

async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true

  logger.info('Shutting down gracefully...')

  // Stop heartbeat loop
  monitor?.stop()
  // Stop NFS health checks
  nfs?.stop()

  // Close health check server
  if (healthServer) {
    await new Promise<void>((resolve) => {
      healthServer!.close(() => resolve())
      setTimeout(resolve, 5000)
    })
  }

  // Wait briefly for any in-flight heartbeat to complete
  await new Promise((resolve) => setTimeout(resolve, 2000))

  logger.info('Agent stopped')
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

logger.info(`Starting Fleet agent for node: ${NODE_ID}`)

monitor = new NodeMonitor(API_URL, NODE_ID, NODE_AUTH_TOKEN)
nfs = new NfsManager()

// Health check HTTP endpoint for Docker healthcheck
healthServer = createServer((req, res) => {
  if (req.url === '/health' && req.method === 'GET') {
    const status = monitor?.isHealthy() ?? false
    res.writeHead(status ? 200 : 503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      status: status ? 'ok' : 'degraded',
      node: NODE_ID,
      uptime: Math.floor(process.uptime()),
      consecutiveFailures: monitor?.getConsecutiveFailures() ?? 0,
    }))
  } else {
    res.writeHead(404)
    res.end()
  }
})

healthServer.listen(HEALTH_PORT, () => {
  logger.info(`Health check server listening on port ${HEALTH_PORT}`)
})

// Start health reporting
monitor.start(HEARTBEAT_INTERVAL)

// Initialize NFS mounts (non-fatal if not available)
try {
  await nfs.initialize()
} catch {
  // NFS not available in this environment
}

logger.info('Agent running')
