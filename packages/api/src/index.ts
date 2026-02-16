import { serve } from '@hono/node-server'
import { createNodeWebSocket } from '@hono/node-ws'
import { app } from './app.js'
import { updateService } from './services/update.service.js'
import { db, platformSettings, eq } from '@fleet/db'

const port = Number(process.env['PORT'] ?? 3000)

// Load JWT secret from DB if not set via env (setup wizard stores it in platformSettings)
async function loadPlatformSecrets() {
  if (!process.env['JWT_SECRET']) {
    try {
      const row = await db.query.platformSettings.findFirst({
        where: eq(platformSettings.key, 'platform:jwtSecret'),
      })
      if (row) {
        // Drizzle's json mode already parses the value
        process.env['JWT_SECRET'] = row.value as string
      }
    } catch {
      // DB may not be initialized yet (first run)
    }
  }
}

await loadPlatformSecrets()

export const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app })

const server = serve({
  fetch: app.fetch,
  port,
})

injectWebSocket(server)

console.log(`Fleet API running on port ${port}`)

// Start periodic update checker (checks GitHub every 6 hours)
updateService.startPeriodicCheck()

// Graceful shutdown — exit immediately so tsx doesn't force-kill
function shutdown() {
  updateService.stopPeriodicCheck()
  try { server.close() } catch {}
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
