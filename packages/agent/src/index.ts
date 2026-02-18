import { NodeMonitor } from './monitor.js'
import { NfsManager } from './nfs.js'
import { logger } from './logger.js'

const HEARTBEAT_INTERVAL = 30_000 // 30 seconds
const API_URL = process.env.API_URL || 'http://localhost:3000'
const NODE_ID = process.env.NODE_ID || 'unknown'

// Register shutdown handlers early — before any async work
let monitor: NodeMonitor | undefined
function shutdown() {
  logger.info('Shutting down...')
  monitor?.stop()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

logger.info(`Starting Fleet agent for node: ${NODE_ID}`)

monitor = new NodeMonitor(API_URL, NODE_ID)
const nfs = new NfsManager()

// Start health reporting
monitor.start(HEARTBEAT_INTERVAL)

// Initialize NFS mounts (non-fatal if not available)
try {
  await nfs.initialize()
} catch {
  // NFS not available in this environment
}

logger.info('Agent running')
