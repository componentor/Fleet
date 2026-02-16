import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { app } from './app.js'
import { updateService } from './services/update.service.js'

const port = Number(process.env['PORT'] ?? 3000)

export const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

const server = serve({
  fetch: app.fetch,
  port,
})

injectWebSocket(server)

console.log(`Fleet API running on port ${port}`)

// Start periodic update checker (checks GitHub every 6 hours)
updateService.startPeriodicCheck()

// Graceful shutdown
function shutdown() {
  console.log('Shutting down API server...')
  updateService.stopPeriodicCheck()
  server.close(() => {
    process.exit(0)
  })
  // Force exit after 3s if server doesn't close
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
