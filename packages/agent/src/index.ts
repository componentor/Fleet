import { NodeMonitor } from './monitor.js'
import { NfsManager } from './nfs.js'

const HEARTBEAT_INTERVAL = 30_000 // 30 seconds
const API_URL = process.env.API_URL || 'http://api:3000'
const NODE_ID = process.env.NODE_ID || 'unknown'

async function main() {
  console.log(`[agent] Starting Fleet agent for node: ${NODE_ID}`)

  const monitor = new NodeMonitor(API_URL, NODE_ID)
  const nfs = new NfsManager()

  // Start health reporting
  monitor.start(HEARTBEAT_INTERVAL)

  // Initialize NFS mounts
  await nfs.initialize()

  console.log('[agent] Agent running')

  // Graceful shutdown
  const shutdown = () => {
    console.log('[agent] Shutting down...')
    monitor.stop()
    process.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error('[agent] Fatal error:', err)
  process.exit(1)
})
